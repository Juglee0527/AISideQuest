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
import { redactSensitiveText, safeErrorSummary } from '../src/common/security/sensitive-redaction'
import { AuthCookieService } from '../src/auth/auth-cookie.service'

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

test('CORS preflight allows only the configured browser origin', async () => {
  const allowed = await request(app.getHttpServer())
    .options('/api/v1/health')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'GET')
    .expect(204)

  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173')
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true')

  const disallowed = await request(app.getHttpServer())
    .options('/api/v1/health')
    .set('Origin', 'https://evil.example')
    .set('Access-Control-Request-Method', 'GET')
    .expect(404)

  assert.equal(disallowed.headers['access-control-allow-origin'], undefined)
})

test('JSON payloads over 16 KiB are rejected before controller handling', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/validation-probe')
    .send({ name: 'x'.repeat(17 * 1_024) })
    .expect(413)

  assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE')
})

test('common redaction removes credentials and local paths from error text', () => {
  const secret = 'super-secret-token'
  const redacted = redactSensitiveText(
    `Authorization: Bearer ${secret} deviceToken=${secret} oauthCode=${secret} cookie=session=${secret} at C:\\Users\\jason\\private\\file.ts`,
  )

  assert.doesNotMatch(redacted, new RegExp(secret))
  assert.doesNotMatch(redacted, /Users\\jason/)
  assert.doesNotMatch(safeErrorSummary(new Error(redacted)), /Users\\jason/)
})

test('production authentication cookies use Secure and __Host- properties', () => {
  const cookies: Array<{
    name: string
    options: Record<string, unknown>
  }> = []
  const cookieService = new AuthCookieService({
    getOrThrow: () => 'production',
  } as never)
  const response = {
    cookie: (name: string, _value: string, options: Record<string, unknown>) => {
      cookies.push({ name, options })
    },
  }

  cookieService.setAuthenticatedSession(
    response as never,
    'session-token',
    'csrf-token',
    new Date(Date.now() + 60_000),
  )

  assert.deepEqual(cookies.map((cookie) => cookie.name), [
    '__Host-aisidequest_session',
    '__Host-aisidequest_csrf',
  ])
  assert.ok(cookies.every((cookie) => cookie.options.secure === true))
  assert.ok(cookies.every((cookie) => cookie.options.path === '/'))
  assert.ok(cookies.every((cookie) => cookie.options.sameSite === 'lax'))
  assert.equal(cookies[0]?.options.httpOnly, true)
  assert.equal(cookies[1]?.options.httpOnly, false)
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
  assert.throws(
    () => validateEnvironment({
      NODE_ENV: 'production',
      GITHUB_CLIENT_ID: 'client',
      GITHUB_CLIENT_SECRET: 'secret',
      GITHUB_CALLBACK_URL: 'https://example.com/api/v1/auth/github/callback',
      AUTH_SUCCESS_REDIRECT_URL: 'https://example.com/',
      AUTH_FAILURE_REDIRECT_URL: 'https://example.com/login-failed',
      CORS_ORIGIN: 'http://example.com',
    }),
    /CORS_ORIGIN must be a valid HTTP or HTTPS origin/,
  )
})
