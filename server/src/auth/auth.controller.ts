import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Body,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

import { AuthCookieService } from './auth-cookie.service'
import { AuthService } from './auth.service'
import type { AuthenticatedRequest } from './auth.types'
import { CsrfGuard } from './csrf.guard'
import { SessionAuthGuard } from './session-auth.guard'

class GithubCallbackQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  state?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  error?: string

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  error_description?: string

  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  error_uri?: string
}

class UpdateTimeZoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timeZone!: string
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Get('github')
  async startGithubLogin(@Res() response: Response) {
    const login = await this.authService.beginGithubLogin()

    this.authCookieService.setOauthState(response, login.state)
    response.redirect(HttpStatus.FOUND, login.authorizationUrl)
  }

  @Get('github/callback')
  async completeGithubLogin(
    @Query() query: GithubCallbackQueryDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const { code, state, error: oauthError } = query
    const stateCookie = this.authCookieService.getOauthState(request)

    if (oauthError) {
      if (!state) {
        throw new UnauthorizedException({ code: 'OAUTH_CALLBACK_INVALID' })
      }

      await this.authService.cancelGithubLogin(state, stateCookie)
      this.authCookieService.clearOauthState(response)
      response.redirect(HttpStatus.FOUND, this.authService.failureRedirectUrl)
      return
    }

    if (!code || !state) {
      throw new UnauthorizedException({ code: 'OAUTH_CALLBACK_INVALID' })
    }

    const login = await this.authService.completeGithubLogin(
      code,
      state,
      stateCookie,
    )

    this.authCookieService.clearOauthState(response)
    this.authCookieService.setAuthenticatedSession(
      response,
      login.sessionToken,
      login.csrfToken,
      login.expiresAt,
    )
    response.redirect(HttpStatus.FOUND, this.authService.successRedirectUrl)
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return request.auth.user
  }

  @Patch('me/time-zone')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  updateTimeZone(
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateTimeZoneDto,
  ) {
    return this.authService.updateTimeZone(request.auth.user.id, body.timeZone)
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.auth)
    this.authCookieService.clearAuthenticatedSession(response)
  }
}
