import 'reflect-metadata'

import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module'
import { configureApplication } from './bootstrap/configure-application'
import { safeErrorSummary } from './common/security/sensitive-redaction'
import { OperationalLoggerService } from './observability/operational-logger.service'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  })
  const configService = app.get(ConfigService)
  const host = configService.getOrThrow<string>('API_HOST')
  const port = configService.getOrThrow<number>('API_PORT')
  const operationalLogger = app.get(OperationalLoggerService)

  configureApplication(app)
  app.enableShutdownHooks()

  await app.listen(port, host)
  operationalLogger.info({ event: 'api_started', host, port })
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'api_start_failed',
    error: safeErrorSummary(error),
  })}\n`)
  process.exitCode = 1
})
