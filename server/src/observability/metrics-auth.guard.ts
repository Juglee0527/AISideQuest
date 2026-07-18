import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'

import { safeEqual } from '../auth/auth-crypto'
import type { AppEnvironment } from '../config/environment'

@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  canActivate(context: ExecutionContext) {
    const expected = this.configService.getOrThrow('METRICS_BEARER_TOKEN')
    if (!expected) throw new NotFoundException({ code: 'NOT_FOUND' })

    const request = context.switchToHttp().getRequest<Request>()
    const match = request.header('authorization')?.match(/^Bearer\s+([^\s]+)$/i)
    if (!match?.[1] || !safeEqual(match[1], expected)) {
      throw new UnauthorizedException({ code: 'METRICS_AUTH_REQUIRED' })
    }

    return true
  }
}
