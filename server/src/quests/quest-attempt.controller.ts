import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'

import { CsrfGuard } from '../auth/csrf.guard'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import {
  assertEmptyBody,
  parseIdempotencyKey,
  parseUuid,
} from '../sessions/session-input'
import { ReplaceQuestAnswersDto } from './quest-attempt.dto'
import { QuestAttemptService } from './quest-attempt.service'

@Controller()
export class QuestAttemptController {
  constructor(private readonly questAttemptService: QuestAttemptService) {}

  @Post('quests/:code/attempts')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  startAttempt(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    assertEmptyBody(request.body, 'quest attempt start does not accept a request body')
    return this.questAttemptService.startAttempt(
      request.auth.user.id,
      code,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Get('quest-attempts/:attemptId')
  @UseGuards(SessionAuthGuard)
  getAttempt(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId') attemptId: string,
  ) {
    return this.questAttemptService.getAttempt(
      request.auth.user.id,
      parseUuid(attemptId, 'attemptId'),
    )
  }

  @Put('quest-attempts/:attemptId/answers')
  @UseGuards(SessionAuthGuard, CsrfGuard)
  replaceAnswers(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId') attemptId: string,
    @Body() body: ReplaceQuestAnswersDto,
  ) {
    return this.questAttemptService.replaceAnswers(
      request.auth.user.id,
      parseUuid(attemptId, 'attemptId'),
      body.answers,
    )
  }

  @Post('quest-attempts/:attemptId/submissions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  submitAttempt(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId') attemptId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    assertEmptyBody(request.body, 'quest submission does not accept a request body')
    return this.questAttemptService.submitAttempt(
      request.auth.user.id,
      parseUuid(attemptId, 'attemptId'),
      parseIdempotencyKey(idempotencyKey),
    )
  }
}
