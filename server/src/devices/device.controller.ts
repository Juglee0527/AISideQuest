import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import {
  CompleteBrowserDeviceLinkRequestDto,
  CreateBrowserDeviceLinkRequestDto,
  CreateDeviceLinkDto,
  RedeemDeviceLinkDto,
} from './device.dto'
import { DeviceService } from './device.service'
import { RateLimit } from '../security/rate-limit.decorator'
import { RateLimitGuard } from '../security/rate-limit.guard'

@Controller()
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post('device-link-requests')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'DEVICE_LINK_REQUEST_CREATE', limit: 20, windowSeconds: 600, identity: 'IP' })
  @UseGuards(RateLimitGuard)
  createBrowserConnectionRequest(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateBrowserDeviceLinkRequestDto,
  ) {
    return this.deviceService.createBrowserConnectionRequest(
      body,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Get('device-link-requests/:requestId')
  @UseGuards(SessionAuthGuard)
  getBrowserConnectionRequest(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
  ) {
    return this.deviceService.getBrowserConnectionRequest(
      request.auth.user.id,
      parseUuid(requestId, 'requestId'),
    )
  }

  @Post('device-link-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'DEVICE_LINK_REQUEST_APPROVE', limit: 20, windowSeconds: 600, identity: 'USER_AND_IP' })
  @UseGuards(SessionAuthGuard, CsrfGuard, RateLimitGuard)
  approveBrowserConnectionRequest(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    assertEmptyBody(request.body, 'device approval does not accept a request body')
    return this.deviceService.approveBrowserConnectionRequest(
      request.auth.user.id,
      parseUuid(requestId, 'requestId'),
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Post('device-link-requests/:requestId/complete')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'DEVICE_LINK_REQUEST_COMPLETE', limit: 720, windowSeconds: 600, identity: 'IP' })
  @UseGuards(RateLimitGuard)
  completeBrowserConnectionRequest(
    @Param('requestId') requestId: string,
    @Body() body: CompleteBrowserDeviceLinkRequestDto,
  ) {
    return this.deviceService.completeBrowserConnectionRequest(
      parseUuid(requestId, 'requestId'),
      body,
    )
  }

  @Post('device-links')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'DEVICE_LINK', limit: 20, windowSeconds: 600, identity: 'USER_AND_IP' })
  @UseGuards(SessionAuthGuard, CsrfGuard, RateLimitGuard)
  createConnectionLink(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateDeviceLinkDto,
  ) {
    return this.deviceService.createConnectionLink(
      request.auth.user.id,
      body,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Post('device-links/redeem')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'DEVICE_REDEEM', limit: 30, windowSeconds: 600, identity: 'IP_AND_LINK_CODE' })
  @UseGuards(RateLimitGuard)
  redeemLink(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: RedeemDeviceLinkDto,
  ) {
    return this.deviceService.redeemLink(
      body,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Get('devices')
  @UseGuards(SessionAuthGuard)
  listDevices(@Req() request: AuthenticatedRequest) {
    return this.deviceService.listDevices(request.auth.user.id)
  }

  @Post('devices/:deviceId/rotation-links')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'DEVICE_ROTATION', limit: 20, windowSeconds: 600, identity: 'USER_AND_IP' })
  @UseGuards(SessionAuthGuard, CsrfGuard, RateLimitGuard)
  createRotationLink(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId') deviceId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateDeviceLinkDto,
  ) {
    return this.deviceService.createRotationLink(
      request.auth.user.id,
      parseUuid(deviceId, 'deviceId'),
      body,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Post('devices/:deviceId/revoke')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'DEVICE_REVOKE', limit: 20, windowSeconds: 600, identity: 'USER_AND_IP' })
  @UseGuards(SessionAuthGuard, CsrfGuard, RateLimitGuard)
  revokeDevice(
    @Req() request: AuthenticatedRequest,
    @Param('deviceId') deviceId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    assertEmptyBody(request.body)

    return this.deviceService.revokeDevice(
      request.auth.user.id,
      parseUuid(deviceId, 'deviceId'),
      parseIdempotencyKey(idempotencyKey),
    )
  }
}
