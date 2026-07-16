import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request, Response } from 'express'

import { AuthCookieService } from './auth-cookie.service'
import { AuthService } from './auth.service'
import type { AuthenticatedRequest } from './auth.types'

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()
    const sessionToken = this.authCookieService.getSessionToken(request)

    if (!sessionToken) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED' })
    }

    try {
      const authSession = await this.authService.authenticate(sessionToken)
      const authenticatedRequest = request as AuthenticatedRequest
      authenticatedRequest.auth = authSession
      return true
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.authCookieService.clearAuthenticatedSession(response)
      }
      throw error
    }
  }
}
