import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import type { Request } from 'express'

import { safeEqual } from './auth-crypto'
import { AuthCookieService } from './auth-cookie.service'
import { AuthService } from './auth.service'
import type { AuthenticatedRequest } from './auth.types'

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & Partial<AuthenticatedRequest>>()
    const csrfCookie = this.authCookieService.getCsrfToken(request)
    const csrfHeader = request.header('x-csrf-token')

    if (
      !request.auth ||
      !csrfCookie ||
      !csrfHeader ||
      csrfCookie.length > 256 ||
      csrfHeader.length > 256 ||
      !safeEqual(csrfCookie, csrfHeader) ||
      !this.authService.verifyCsrf(request.auth, csrfHeader)
    ) {
      throw new ForbiddenException({ code: 'CSRF_TOKEN_INVALID' })
    }

    return true
  }
}
