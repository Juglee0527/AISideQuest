import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common'
import { map, type Observable } from 'rxjs'
import type { OperationalRequest } from '../../observability/operational-request'

export interface ApiSuccessResponse<T> {
  data: T | null
  meta: {
    serverTime: string
    requestId: string
  }
}

@Injectable()
export class ApiResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<OperationalRequest>()
    return next.handle().pipe(
      map((data) => ({
        data: data === undefined ? null : data,
        meta: {
          serverTime: request.responseServerTime ?? new Date().toISOString(),
          requestId: request.requestId,
        },
      })),
    )
  }
}
