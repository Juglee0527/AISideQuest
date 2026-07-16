import { Module } from '@nestjs/common'

import { AuthController } from './auth.controller'
import { AuthCookieService } from './auth-cookie.service'
import { AuthService } from './auth.service'
import { CsrfGuard } from './csrf.guard'
import { GithubOAuthClient } from './github-oauth.client'
import { SessionAuthGuard } from './session-auth.guard'

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    GithubOAuthClient,
    SessionAuthGuard,
    CsrfGuard,
  ],
  exports: [
    AuthService,
    AuthCookieService,
    SessionAuthGuard,
    CsrfGuard,
  ],
})
export class AuthModule {}
