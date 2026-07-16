import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import cookieParser from 'cookie-parser'

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
  app.use(cookieParser())
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  })
  app.useGlobalPipes(createValidationPipe())
  app.useGlobalInterceptors(new ApiResponseInterceptor())
  app.useGlobalFilters(new ApiExceptionFilter())
}
