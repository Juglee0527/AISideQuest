import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'

import type { AppEnvironment } from '../config/environment'
import { DeviceAuthGuard } from './device-auth.guard'
import { IntegrationEventDto } from './session.dto'
import { parseIdempotencyKey, validationError } from './session-input'
import { SessionService } from './session.service'
import type { DeviceAuthenticatedRequest } from './session.types'
import { RateLimit } from '../security/rate-limit.decorator'
import { RateLimitGuard } from '../security/rate-limit.guard'

@Controller('integration-events')
export class IntegrationEventController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'INTEGRATION_EVENT', limit: 240, windowSeconds: 60, identity: 'DEVICE_AND_IP' })
  @UseGuards(RateLimitGuard, DeviceAuthGuard)
  receiveEvent(
    @Req() request: DeviceAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: IntegrationEventDto,
  ) {
    if (!this.configService.getOrThrow('INTEGRATION_EVENTS_ENABLED')) {
      response.setHeader('Retry-After', '60')
      throw new ServiceUnavailableException({
        code: 'INTEGRATION_EVENTS_PAUSED',
      })
    }

    const parsedIdempotencyKey = parseIdempotencyKey(idempotencyKey)

    if (parsedIdempotencyKey !== body.eventId.toLowerCase()) {
      validationError('Idempotency-Key must match eventId')
    }

    return this.sessionService.processIntegrationEvent(
      request.deviceAuth,
      body,
    )
  }
}
