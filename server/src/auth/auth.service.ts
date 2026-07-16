import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EntityManager } from 'typeorm'

import type { AppEnvironment } from '../config/environment'
import { DatabaseService } from '../database/database.service'
import {
  createPkceChallenge,
  createRandomToken,
  hashToken,
  safeEqual,
} from './auth-crypto'
import type {
  AuthSessionContext,
  AuthUser,
  GithubUserProfile,
} from './auth.types'
import { GithubOAuthClient } from './github-oauth.client'

interface OAuthStateRow {
  code_verifier: string
}

interface UserRow {
  id: string
  display_name: string
  avatar_url: string | null
  provider_login: string
}

interface AuthSessionRow extends UserRow {
  session_id: string
  csrf_token_hash: string
}

interface CreatedSessionRow {
  id: string
  expires_at: Date
}

export interface CompletedLogin {
  user: AuthUser
  sessionToken: string
  csrfToken: string
  expiresAt: Date
}

@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  async beginGithubLogin() {
    this.githubOAuthClient.assertConfigured()

    const state = createRandomToken()
    const codeVerifier = createRandomToken()

    await this.databaseService.query(
      'DELETE FROM oauth_login_states WHERE expires_at <= now()',
    )
    await this.databaseService.query(
      `
        INSERT INTO oauth_login_states (
          state_hash, code_verifier, expires_at
        )
        VALUES ($1, $2, now() + interval '10 minutes')
      `,
      [hashToken(state), codeVerifier],
    )

    return {
      state,
      authorizationUrl: this.githubOAuthClient.createAuthorizationUrl(
        state,
        createPkceChallenge(codeVerifier),
      ),
    }
  }

  async completeGithubLogin(
    code: string,
    returnedState: string,
    stateCookie: string | undefined,
  ): Promise<CompletedLogin> {
    if (code.trim() === '') {
      throw new UnauthorizedException({ code: 'OAUTH_CALLBACK_INVALID' })
    }

    const codeVerifier = await this.consumeOAuthState(
      returnedState,
      stateCookie,
    )

    const profile = await this.githubOAuthClient.getAuthenticatedUser(
      code,
      codeVerifier,
    )
    const sessionToken = createRandomToken()
    const csrfToken = createRandomToken()

    return this.databaseService.transaction(async (manager) => {
      const user = await this.findOrCreateUser(manager, profile)
      const sessions = (await manager.query(
        `
          INSERT INTO auth_sessions (
            user_id, token_hash, csrf_token_hash, expires_at
          )
          VALUES (
            $1,
            $2,
            $3,
            now() + make_interval(hours => $4)
          )
          RETURNING id, expires_at
        `,
        [
          user.id,
          hashToken(sessionToken),
          hashToken(csrfToken),
          this.configService.getOrThrow('AUTH_SESSION_TTL_HOURS'),
        ],
      )) as CreatedSessionRow[]
      const session = sessions[0]

      if (!session) {
        throw new Error('Failed to create authentication session')
      }

      return {
        user,
        sessionToken,
        csrfToken,
        expiresAt: session.expires_at,
      }
    })
  }

  async cancelGithubLogin(
    returnedState: string,
    stateCookie: string | undefined,
  ) {
    await this.consumeOAuthState(returnedState, stateCookie)
  }

  async authenticate(sessionToken: string): Promise<AuthSessionContext> {
    if (sessionToken.length > 256) {
      throw new UnauthorizedException({ code: 'AUTH_SESSION_INVALID' })
    }

    const sessions = await this.databaseService.query<AuthSessionRow[]>(
      `
        SELECT
          auth_sessions.id AS session_id,
          auth_sessions.csrf_token_hash,
          users.id,
          users.display_name,
          users.avatar_url,
          user_auth_accounts.provider_login
        FROM auth_sessions
        JOIN users ON users.id = auth_sessions.user_id
        JOIN user_auth_accounts
          ON user_auth_accounts.user_id = users.id
          AND user_auth_accounts.provider = 'GITHUB'
        WHERE auth_sessions.token_hash = $1
          AND auth_sessions.revoked_at IS NULL
          AND auth_sessions.expires_at > now()
          AND users.deleted_at IS NULL
      `,
      [hashToken(sessionToken)],
    )
    const session = sessions[0]

    if (!session) {
      throw new UnauthorizedException({ code: 'AUTH_SESSION_INVALID' })
    }

    await this.databaseService.query(
      `
        UPDATE auth_sessions
        SET last_seen_at = now()
        WHERE id = $1
          AND last_seen_at < now() - interval '5 minutes'
      `,
      [session.session_id],
    )

    return {
      sessionId: session.session_id,
      csrfTokenHash: session.csrf_token_hash,
      user: this.mapUser(session),
    }
  }

  verifyCsrf(session: AuthSessionContext, csrfToken: string) {
    return (
      csrfToken.length <= 256 &&
      safeEqual(hashToken(csrfToken), session.csrfTokenHash)
    )
  }

  async logout(session: AuthSessionContext) {
    await this.databaseService.query(
      `
        UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1
      `,
      [session.sessionId],
    )
  }

  get successRedirectUrl() {
    return this.configService.getOrThrow('AUTH_SUCCESS_REDIRECT_URL')
  }

  get failureRedirectUrl() {
    return this.configService.getOrThrow('AUTH_FAILURE_REDIRECT_URL')
  }

  private async findOrCreateUser(
    manager: EntityManager,
    profile: GithubUserProfile,
  ): Promise<AuthUser> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`GITHUB:${profile.id}`],
    )

    const existingUsers = (await manager.query(
      `
        SELECT
          users.id,
          users.display_name,
          users.avatar_url,
          user_auth_accounts.provider_login
        FROM user_auth_accounts
        JOIN users ON users.id = user_auth_accounts.user_id
        WHERE user_auth_accounts.provider = 'GITHUB'
          AND user_auth_accounts.provider_account_id = $1
      `,
      [profile.id],
    )) as UserRow[]
    const existingUser = existingUsers[0]
    const displayName = (profile.name ?? profile.login).slice(0, 100)

    if (existingUser) {
      const updatedUsers = (await manager.query(
        `
          UPDATE users
          SET display_name = $2,
              avatar_url = $3,
              updated_at = now()
          WHERE id = $1
            AND deleted_at IS NULL
          RETURNING id, display_name, avatar_url
        `,
        [existingUser.id, displayName, profile.avatarUrl],
      )) as Array<Omit<UserRow, 'provider_login'>>

      if (!updatedUsers[0]) {
        throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_DELETED' })
      }

      await manager.query(
        `
          UPDATE user_auth_accounts
          SET provider_login = $2,
              updated_at = now()
          WHERE user_id = $1
            AND provider = 'GITHUB'
        `,
        [existingUser.id, profile.login],
      )

      return {
        id: existingUser.id,
        displayName,
        avatarUrl: profile.avatarUrl,
        githubLogin: profile.login,
      }
    }

    const users = (await manager.query(
      `
        INSERT INTO users (display_name, avatar_url)
        VALUES ($1, $2)
        RETURNING id, display_name, avatar_url
      `,
      [displayName, profile.avatarUrl],
    )) as Array<Omit<UserRow, 'provider_login'>>
    const user = users[0]

    if (!user) {
      throw new Error('Failed to create user')
    }

    await manager.query(
      `
        INSERT INTO user_auth_accounts (
          user_id, provider, provider_account_id, provider_login
        )
        VALUES ($1, 'GITHUB', $2, $3)
      `,
      [user.id, profile.id, profile.login],
    )

    return {
      id: user.id,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      githubLogin: profile.login,
    }
  }

  private mapUser(row: UserRow): AuthUser {
    return {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      githubLogin: row.provider_login,
    }
  }

  private async consumeOAuthState(
    returnedState: string,
    stateCookie: string | undefined,
  ) {
    if (
      !stateCookie ||
      returnedState.length > 256 ||
      stateCookie.length > 256 ||
      !safeEqual(returnedState, stateCookie)
    ) {
      throw new UnauthorizedException({ code: 'OAUTH_STATE_INVALID' })
    }

    const [states] = await this.databaseService.query<
      [OAuthStateRow[], number]
    >(
      `
        DELETE FROM oauth_login_states
        WHERE state_hash = $1
          AND expires_at > now()
        RETURNING code_verifier
      `,
      [hashToken(returnedState)],
    )
    const oauthState = states[0]

    if (!oauthState) {
      throw new UnauthorizedException({ code: 'OAUTH_STATE_INVALID' })
    }

    return oauthState.code_verifier
  }
}
