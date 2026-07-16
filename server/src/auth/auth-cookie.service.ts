import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { CookieOptions, Request, Response } from 'express'

import type { AppEnvironment } from '../config/environment'

const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000

@Injectable()
export class AuthCookieService {
  constructor(
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  setOauthState(response: Response, state: string) {
    response.cookie(this.oauthStateCookieName, state, {
      ...this.baseCookieOptions,
      httpOnly: true,
      maxAge: OAUTH_STATE_TTL_MS,
    })
  }

  clearOauthState(response: Response) {
    response.clearCookie(this.oauthStateCookieName, {
      ...this.baseCookieOptions,
      httpOnly: true,
    })
  }

  setAuthenticatedSession(
    response: Response,
    sessionToken: string,
    csrfToken: string,
    expiresAt: Date,
  ) {
    const maxAge = Math.max(0, expiresAt.getTime() - Date.now())

    response.cookie(this.sessionCookieName, sessionToken, {
      ...this.baseCookieOptions,
      httpOnly: true,
      maxAge,
    })
    response.cookie(this.csrfCookieName, csrfToken, {
      ...this.baseCookieOptions,
      httpOnly: false,
      maxAge,
    })
  }

  clearAuthenticatedSession(response: Response) {
    response.clearCookie(this.sessionCookieName, {
      ...this.baseCookieOptions,
      httpOnly: true,
    })
    response.clearCookie(this.csrfCookieName, {
      ...this.baseCookieOptions,
      httpOnly: false,
    })
  }

  getOauthState(request: Request) {
    return this.readCookie(request, this.oauthStateCookieName)
  }

  getSessionToken(request: Request) {
    return this.readCookie(request, this.sessionCookieName)
  }

  getCsrfToken(request: Request) {
    return this.readCookie(request, this.csrfCookieName)
  }

  private readCookie(request: Request, name: string) {
    const cookies = request.cookies as Record<string, unknown> | undefined
    const value = cookies?.[name]

    return typeof value === 'string' && value !== '' ? value : undefined
  }

  private get baseCookieOptions(): CookieOptions {
    return {
      secure: this.isProduction,
      sameSite: 'lax',
      path: '/',
    }
  }

  private get cookiePrefix() {
    return this.isProduction ? '__Host-' : ''
  }

  private get sessionCookieName() {
    return `${this.cookiePrefix}aisidequest_session`
  }

  private get csrfCookieName() {
    return `${this.cookiePrefix}aisidequest_csrf`
  }

  private get oauthStateCookieName() {
    return `${this.cookiePrefix}aisidequest_oauth_state`
  }

  private get isProduction() {
    return this.configService.getOrThrow('NODE_ENV') === 'production'
  }
}
