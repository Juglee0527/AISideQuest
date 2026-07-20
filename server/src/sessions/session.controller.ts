import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'

import { CsrfGuard } from '../auth/csrf.guard'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import { EndSessionDto, SessionHistoryQueryDto } from './session.dto'
import {
  assertEmptyBody,
  parseIdempotencyKey,
  parseUuid,
} from './session-input'
import { SessionService } from './session.service'

@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('manual')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  startManualSession(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    assertEmptyBody(request.body)

    return this.sessionService.startManualSession(
      request.auth.user.id,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Post(':sessionId/end')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  endSession(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId') sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: EndSessionDto,
  ) {
    return this.sessionService.endSession(
      request.auth.user.id,
      parseUuid(sessionId, 'sessionId'),
      body.outcome,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Get('active')
  @UseGuards(SessionAuthGuard)
  getActiveSessions(@Req() request: AuthenticatedRequest) {
    return this.sessionService.getActiveSessions(request.auth.user.id)
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  getSessionHistory(
    @Req() request: AuthenticatedRequest,
    @Query() query: SessionHistoryQueryDto,
  ) {
    return this.sessionService.getSessionHistory(request.auth.user.id, query)
  }
}
