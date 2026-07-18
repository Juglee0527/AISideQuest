import 'reflect-metadata'

import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module'
import { configureApplication } from './bootstrap/configure-application'
import { safeErrorSummary } from './common/security/sensitive-redaction'

const bootstrapLogger = new Logger('Bootstrap')

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const configService = app.get(ConfigService)
  const host = configService.getOrThrow<string>('API_HOST')
  const port = configService.getOrThrow<number>('API_PORT')

  configureApplication(app)
  app.enableShutdownHooks()

  await app.listen(port, host)
  bootstrapLogger.log(`AISideQuest API listening on http://${host}:${port}/api/v1`)
}

void bootstrap().catch((error: unknown) => {
  bootstrapLogger.error(`AISideQuest API failed to start: ${safeErrorSummary(error)}`)
  process.exitCode = 1
})
