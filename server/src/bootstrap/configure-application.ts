import { ValidationPipe, type INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ConfigService } from '@nestjs/config'
import cookieParser from 'cookie-parser'
import type { NextFunction, Request, Response } from 'express'

import { ApiExceptionFilter } from '../common/http/api-exception.filter'
import { ApiResponseInterceptor } from '../common/http/api-response.interceptor'

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

  app.setGlobalPrefix(API_PREFIX)
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
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
  app.useGlobalInterceptors(new ApiResponseInterceptor())
  app.useGlobalFilters(new ApiExceptionFilter())
}
