import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'

import type { AuthenticatedRequest } from '../auth/auth.types'
import type { DeviceAuthenticatedRequest } from '../sessions/session.types'
import {
  RATE_LIMIT_METADATA,
  type RateLimitIdentity,
  type RateLimitPolicy,
} from './rate-limit.decorator'
import { RateLimitService } from './rate-limit.service'

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    )

    if (!policy) {
      return true
    }

    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()
    const ip = this.getIp(request)
    const identity = this.createIdentity(request, policy.identity)
    const needsIpCeiling = policy.identity === 'IP_AND_STATE'
      || policy.identity === 'IP_AND_LINK_CODE'
      || policy.identity === 'DEVICE_AND_IP'

    if (needsIpCeiling) {
      const ipResult = await this.rateLimitService.consume(
        `${policy.scope}:IP`,
        ip,
        policy.limit * 2,
        policy.windowSeconds,
      )

      if (!ipResult.allowed) {
        this.reject(response, ipResult.retryAfterSeconds)
      }
    }

    const result = await this.rateLimitService.consume(
      policy.scope,
      identity,
      policy.limit,
      policy.windowSeconds,
    )

    if (!result.allowed) {
      this.reject(response, result.retryAfterSeconds)
    }

    return true
  }

  private createIdentity(request: Request, type: RateLimitIdentity) {
    const ip = this.getIp(request)
    const auth = (request as Partial<AuthenticatedRequest>).auth
    const deviceAuth = (request as Partial<DeviceAuthenticatedRequest>).deviceAuth
    const queryState = typeof request.query.state === 'string'
      ? request.query.state.slice(0, 256)
      : 'missing'
    const body = this.isRecord(request.body) ? request.body : {}
    const linkCode = typeof body.code === 'string'
      ? body.code.slice(0, 128)
      : 'missing'
    const authorization = request.header('authorization')?.slice(0, 512)

    switch (type) {
      case 'IP_AND_STATE':
        return `${ip}:state:${queryState}`
      case 'USER_AND_IP':
        return `${auth?.user.id ?? 'anonymous'}:${ip}`
      case 'DEVICE_AND_IP':
        return `${deviceAuth?.deviceId ?? authorization ?? 'anonymous'}:${ip}`
      case 'IP_AND_LINK_CODE':
        return `${ip}:link:${linkCode}`
      default:
        return ip
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private getIp(request: Request) {
    return request.ip || request.socket.remoteAddress || 'unknown'
  }

  private reject(response: Response, retryAfterSeconds: number): never {
    response.setHeader('Retry-After', String(retryAfterSeconds))
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }
}
