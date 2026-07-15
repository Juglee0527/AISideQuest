import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common'
import { map, type Observable } from 'rxjs'

export interface ApiSuccessResponse<T> {
  data: T | null
  meta: {
    serverTime: string
  }
}

@Injectable()
export class ApiResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        data: data === undefined ? null : data,
        meta: {
          serverTime: new Date().toISOString(),
        },
      })),
    )
  }
}
