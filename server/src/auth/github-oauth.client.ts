import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AppEnvironment } from '../config/environment'
import type { GithubUserProfile } from './auth.types'

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_API_VERSION = '2026-03-10'
const REQUEST_TIMEOUT_MS = 10_000

interface GithubAccessTokenResponse {
  access_token?: unknown
  error?: unknown
}

interface GithubUserResponse {
  id?: unknown
  login?: unknown
  name?: unknown
  avatar_url?: unknown
}

@Injectable()
export class GithubOAuthClient {
  constructor(
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  assertConfigured() {
    if (!this.getClientId() || !this.getClientSecret()) {
      throw new ServiceUnavailableException({ code: 'OAUTH_NOT_CONFIGURED' })
    }
  }

  createAuthorizationUrl(state: string, codeChallenge: string) {
    this.assertConfigured()

    const authorizationUrl = new URL(GITHUB_AUTHORIZE_URL)
    authorizationUrl.searchParams.set('client_id', this.getClientId())
    authorizationUrl.searchParams.set(
      'redirect_uri',
      this.configService.getOrThrow('GITHUB_CALLBACK_URL'),
    )
    authorizationUrl.searchParams.set('state', state)
    authorizationUrl.searchParams.set('code_challenge', codeChallenge)
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')

    return authorizationUrl.toString()
  }

  async getAuthenticatedUser(code: string, codeVerifier: string) {
    this.assertConfigured()

    const accessToken = await this.exchangeCode(code, codeVerifier)
    return this.fetchUser(accessToken)
  }

  private async exchangeCode(code: string, codeVerifier: string) {
    const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'AISideQuest/0.1.0',
      },
      body: new URLSearchParams({
        client_id: this.getClientId(),
        client_secret: this.getClientSecret(),
        code,
        redirect_uri: this.configService.getOrThrow('GITHUB_CALLBACK_URL'),
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    const payload = (await response.json()) as GithubAccessTokenResponse

    if (
      !response.ok ||
      typeof payload.access_token !== 'string' ||
      payload.access_token === '' ||
      payload.error !== undefined
    ) {
      throw new UnauthorizedException({ code: 'GITHUB_OAUTH_FAILED' })
    }

    return payload.access_token
  }

  private async fetchUser(accessToken: string): Promise<GithubUserProfile> {
    const response = await fetch(GITHUB_USER_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'AISideQuest/0.1.0',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const payload = (await response.json()) as GithubUserResponse

    if (
      !response.ok ||
      (typeof payload.id !== 'number' && typeof payload.id !== 'string') ||
      typeof payload.login !== 'string' ||
      payload.login.trim() === ''
    ) {
      throw new UnauthorizedException({ code: 'GITHUB_IDENTITY_INVALID' })
    }

    return {
      id: String(payload.id),
      login: payload.login,
      name:
        typeof payload.name === 'string' && payload.name.trim() !== ''
          ? payload.name.trim()
          : null,
      avatarUrl:
        typeof payload.avatar_url === 'string' && payload.avatar_url !== ''
          ? payload.avatar_url
          : null,
    }
  }

  private getClientId() {
    return this.configService.getOrThrow('GITHUB_CLIENT_ID')
  }

  private getClientSecret() {
    return this.configService.getOrThrow('GITHUB_CLIENT_SECRET')
  }
}
