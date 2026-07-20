import { Global, Module } from '@nestjs/common'

import { ApiExceptionFilter } from '../common/http/api-exception.filter'
import { ApiResponseInterceptor } from '../common/http/api-response.interceptor'
import { MetricsAuthGuard } from './metrics-auth.guard'
import { OperationalLoggerService } from './operational-logger.service'
import { OperationalMetricsService } from './operational-metrics.service'

@Global()
@Module({
  providers: [
    OperationalLoggerService,
    OperationalMetricsService,
    MetricsAuthGuard,
    ApiExceptionFilter,
    ApiResponseInterceptor,
  ],
  exports: [
    OperationalLoggerService,
    OperationalMetricsService,
    MetricsAuthGuard,
    ApiExceptionFilter,
    ApiResponseInterceptor,
  ],
})
export class ObservabilityModule {}
