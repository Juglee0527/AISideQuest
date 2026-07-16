import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import { DeviceAuthService } from './device-auth.service'
import type { DeviceAuthenticatedRequest } from './session.types'

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly deviceAuthService: DeviceAuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>()
    const authorization = request.header('authorization')
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i)

    if (!match?.[1]) {
      throw new UnauthorizedException({ code: 'DEVICE_AUTH_REQUIRED' })
    }

    const deviceAuth = await this.deviceAuthService.authenticate(match[1])
    const authenticatedRequest = request as DeviceAuthenticatedRequest
    authenticatedRequest.deviceAuth = deviceAuth
    return true
  }
}
