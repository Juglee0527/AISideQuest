import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'

import type { AuthenticatedRequest } from './auth.types'

const RECENT_AUTHENTICATION_MS = 15 * 60 * 1_000

@Injectable()
export class RecentAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const authenticatedAt = request.auth?.authenticatedAt

    if (
      !authenticatedAt
      || Date.now() - authenticatedAt.getTime() > RECENT_AUTHENTICATION_MS
    ) {
      throw new ForbiddenException({
        code: 'RECENT_AUTHENTICATION_REQUIRED',
        message: '민감한 작업을 계속하려면 다시 로그인해 주세요.',
      })
    }

    return true
  }
}
