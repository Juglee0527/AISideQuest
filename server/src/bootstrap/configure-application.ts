import { ValidationPipe, type INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ConfigService } from '@nestjs/config'
import cookieParser from 'cookie-parser'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'

import { ApiExceptionFilter } from '../common/http/api-exception.filter'
import { ApiResponseInterceptor } from '../common/http/api-response.interceptor'
import { isValidRequestId, routeTemplate, type OperationalRequest } from '../observability/operational-request'
import { OperationalLoggerService } from '../observability/operational-logger.service'
import { OperationalMetricsService } from '../observability/operational-metrics.service'

export const API_PREFIX = 'api/v1'

export function createValidationPipe() {
  return new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    stopAtFirstError: false,
  })
}

export function configureApplication(app: INestApplication) {
  const configService = app.get(ConfigService)
  const corsOrigin = configService.getOrThrow<string>('CORS_ORIGIN')
  const operationalLogger = app.get(OperationalLoggerService)
  const operationalMetrics = app.get(OperationalMetricsService)

  ;(app as NestExpressApplication).set(
    'trust proxy',
    configService.getOrThrow<number>('TRUST_PROXY_HOPS'),
  )

  app.setGlobalPrefix(API_PREFIX)
  app.use((request: Request, response: Response, next: NextFunction) => {
    const operationalRequest = request as OperationalRequest
    const incomingRequestId = request.header('x-request-id')
    const startedAt = process.hrtime.bigint()
    operationalRequest.requestId = isValidRequestId(incomingRequestId)
      ? incomingRequestId
      : randomUUID()
    response.setHeader('X-Request-ID', operationalRequest.requestId)
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.once('finish', () => {
      const route = routeTemplate(request)
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
      const errorCode = typeof response.locals.apiErrorCode === 'string'
        ? response.locals.apiErrorCode
        : undefined
      operationalMetrics.recordHttp(request.method, route, response.statusCode)
      operationalLogger.info({
        event: 'http_request',
        requestId: operationalRequest.requestId,
        method: request.method,
        route,
        status: response.statusCode,
        latencyMs: Math.round(latencyMs * 100) / 100,
        errorCode,
      })
    })
    next()
  })
  ;(app as NestExpressApplication).useBodyParser('json', {
    limit: '16kb',
    strict: true,
  })
  app.use(cookieParser())
  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, requestOrigin === undefined || requestOrigin === corsOrigin)
    },
    credentials: true,
  })
  app.useGlobalPipes(createValidationPipe())
  app.useGlobalInterceptors(app.get(ApiResponseInterceptor))
  app.useGlobalFilters(app.get(ApiExceptionFilter))
}
