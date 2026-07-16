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
import { CreateDeviceLinkDto, RedeemDeviceLinkDto } from './device.dto'
import { DeviceService } from './device.service'

@Controller()
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post('device-links')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
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
  @UseGuards(SessionAuthGuard, CsrfGuard)
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
  @UseGuards(SessionAuthGuard, CsrfGuard)
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
