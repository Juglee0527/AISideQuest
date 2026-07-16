import 'reflect-metadata'

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import {
  Body,
  Controller,
  type INestApplication,
  Post,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { IsNotEmpty, IsString } from 'class-validator'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/bootstrap/configure-application'
import { validateEnvironment } from '../src/config/environment'
import { DatabaseService } from '../src/database/database.service'

class ValidationProbeDto {
  @IsString()
  @IsNotEmpty()
  name!: string
}

@Controller('validation-probe')
class ValidationProbeController {
  @Post()
  validate(@Body() body: ValidationProbeDto) {
    return body
  }
}

let app: INestApplication

before(async () => {
  const testingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ValidationProbeController],
  })
    .overrideProvider(DatabaseService)
    .useValue({
      onModuleInit: () => undefined,
      onModuleDestroy: () => undefined,
    })
    .compile()

  app = testingModule.createNestApplication()
  configureApplication(app)
  await app.init()
})

after(async () => {
  await app.close()
})

test('GET /api/v1/health returns the common success envelope', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/v1/health')
    .expect(200)

  assert.deepEqual(response.body.data, {
    status: 'ok',
    service: 'aisidequest-api',
  })
  assert.match(response.body.meta.serverTime, /^\d{4}-\d{2}-\d{2}T/)
})

test('global validation rejects unknown input with the common error envelope', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/validation-probe')
    .send({ name: 'valid', unexpected: true })
    .expect(400)

  assert.equal(response.body.error.code, 'VALIDATION_ERROR')
  assert.equal(response.body.error.message, '요청값이 올바르지 않습니다.')
  assert.ok(
    response.body.error.details.some((detail: string) =>
      detail.includes('unexpected'),
    ),
  )
  assert.match(response.body.meta.serverTime, /^\d{4}-\d{2}-\d{2}T/)
})

test('unknown routes return a safe 404 response', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/v1/not-found')
    .expect(404)

  assert.deepEqual(response.body.error, {
    code: 'NOT_FOUND',
    message: '요청한 리소스를 찾을 수 없습니다.',
  })
})

test('environment validation applies defaults and rejects invalid ports', () => {
  const environment = validateEnvironment({})

  assert.equal(environment.NODE_ENV, 'development')
  assert.equal(environment.API_HOST, '127.0.0.1')
  assert.equal(environment.API_PORT, 3000)
  assert.equal(environment.CORS_ORIGIN, 'http://localhost:5173')
  assert.equal(
    environment.DATABASE_URL,
    'postgresql://aisidequest:aisidequest@127.0.0.1:54329/aisidequest',
  )
  assert.equal(environment.DATABASE_SSL, false)
  assert.equal(environment.GITHUB_CLIENT_ID, '')
  assert.equal(environment.GITHUB_CLIENT_SECRET, '')
  assert.equal(
    environment.GITHUB_CALLBACK_URL,
    'http://localhost:3000/api/v1/auth/github/callback',
  )
  assert.equal(environment.AUTH_SESSION_TTL_HOURS, 168)
  assert.throws(
    () => validateEnvironment({ API_PORT: '0' }),
    /API_PORT must be an integer between 1 and 65535/,
  )
  assert.throws(
    () => validateEnvironment({ DATABASE_URL: 'https://example.com/db' }),
    /DATABASE_URL must be a valid PostgreSQL connection URL/,
  )
  assert.throws(
    () => validateEnvironment({ DATABASE_SSL: 'yes' }),
    /DATABASE_SSL must be true or false/,
  )
  assert.throws(
    () => validateEnvironment({ AUTH_SESSION_TTL_HOURS: '0' }),
    /AUTH_SESSION_TTL_HOURS must be an integer from 1 to 720/,
  )
  assert.throws(
    () =>
      validateEnvironment({
        GITHUB_CALLBACK_URL:
          'http://127.0.0.1:3000/api/v1/auth/github/callback',
      }),
    /GITHUB_CALLBACK_URL and CORS_ORIGIN must use the same hostname/,
  )
  assert.throws(
    () => validateEnvironment({ NODE_ENV: 'production' }),
    /GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required in production/,
  )
})
