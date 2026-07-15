import 'reflect-metadata'

import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { configureApplication } from './bootstrap/configure-application'

const bootstrapLogger = new Logger('Bootstrap')

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const configService = app.get(ConfigService)
  const host = configService.getOrThrow<string>('API_HOST')
  const port = configService.getOrThrow<number>('API_PORT')

  configureApplication(app)
  app.enableShutdownHooks()

  await app.listen(port, host)
  bootstrapLogger.log(`AISideQuest API listening on http://${host}:${port}/api/v1`)
}

void bootstrap().catch((error: unknown) => {
  bootstrapLogger.error(
    'AISideQuest API failed to start',
    error instanceof Error ? error.stack : undefined,
  )
  process.exitCode = 1
})
