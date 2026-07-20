import { Module } from '@nestjs/common'

import { AuthController } from './auth.controller'
import { AuthCookieService } from './auth-cookie.service'
import { AuthService } from './auth.service'
import { CsrfGuard } from './csrf.guard'
import { GithubOAuthClient } from './github-oauth.client'
import { SessionAuthGuard } from './session-auth.guard'
import { RecentAuthenticationGuard } from './recent-authentication.guard'
import { UserDataService } from './user-data.service'

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    GithubOAuthClient,
    SessionAuthGuard,
    CsrfGuard,
    RecentAuthenticationGuard,
    UserDataService,
  ],
  exports: [
    AuthService,
    AuthCookieService,
    SessionAuthGuard,
    CsrfGuard,
    RecentAuthenticationGuard,
  ],
})
export class AuthModule {}
