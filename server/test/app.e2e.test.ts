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
import { ConfigService } from '@nestjs/config'
import { IsNotEmpty, IsString } from 'class-validator'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/bootstrap/configure-application'
import { validateEnvironment } from '../src/config/environment'
import { DatabaseService } from '../src/database/database.service'
import { redactSensitiveText, safeErrorSummary } from '../src/common/security/sensitive-redaction'
import { AuthCookieService } from '../src/auth/auth-cookie.service'
import { sanitizeOperationalEvent } from '../src/observability/operational-logger.service'

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
let databaseReady = true
const metricsToken = 'test-metrics-token-with-at-least-32-characters'

before(async () => {
  const testingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ValidationProbeController],
  })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(validateEnvironment({
      NODE_ENV: 'test',
      METRICS_BEARER_TOKEN: metricsToken,
    })))
    .overrideProvider(DatabaseService)
    .useValue({
      onModuleInit: () => undefined,
      onModuleDestroy: () => undefined,
      checkReadiness: () => databaseReady,
      getOperationalSnapshot: () => ({
        activeSessions: 2,
        heartbeatTimeouts15m: 1,
        automaticTerminals15m: 4,
        lateStopRecoveries15m: 1,
        deferredEvents: 3,
        deferredOldestAgeSeconds: 10,
        staleDevices: 4,
        pluginQueueDepth: 5,
        pluginQueueOldestAgeSeconds: 6,
        pluginDeadLetters: 7,
        databasePool: { total: 8, idle: 7, waiting: 1 },
      }),
      getDiscoverOperationalSnapshot: () => ({
        sources: [{ source: 'HACKER_NEWS', freshnessSeconds: 60, itemCount: 12 }],
        productEvents30d: [{
          eventName: 'DISCOVER_VIEW', source: 'NONE', category: 'NONE', count: 3,
        }],
      }),
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
  assert.equal(response.body.meta.requestId, response.headers['x-request-id'])
})

test('Discover read endpoints require a browser session', async () => {
  for (const path of ['/api/v1/discover', '/api/v1/discover/sources']) {
    const response = await request(app.getHttpServer()).get(path).expect(401)
    assert.equal(response.body.error.code, 'AUTH_REQUIRED')
  }
})

test('request IDs are accepted only in the safe format and echoed consistently', async () => {
  const accepted = await request(app.getHttpServer())
    .get('/api/v1/health/live')
    .set('x-request-id', 'client-request_1234')
    .expect(200)
  assert.equal(accepted.headers['x-request-id'], 'client-request_1234')
  assert.equal(accepted.body.meta.requestId, 'client-request_1234')

  const replaced = await request(app.getHttpServer())
    .get('/api/v1/health/live')
    .set('x-request-id', 'unsafe request id with spaces')
    .expect(200)
  assert.match(replaced.headers['x-request-id'], /^[0-9a-f-]{36}$/)
})

test('readiness checks DB and migrations without exposing failure details', async () => {
  await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200)
  databaseReady = false
  const unavailable = await request(app.getHttpServer())
    .get('/api/v1/health/ready')
    .expect(503)
  assert.equal(unavailable.body.error.code, 'NOT_READY')
  assert.doesNotMatch(JSON.stringify(unavailable.body), /database|migration/i)
  databaseReady = true
})

test('database startup failure leaves the process available but readiness false', async () => {
  const unavailableDatabase = new DatabaseService(new ConfigService(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unavailable?connect_timeout=1',
    }),
  ))
  await assert.doesNotReject(unavailableDatabase.onModuleInit())
  assert.equal(await unavailableDatabase.checkReadiness(50), false)
  await unavailableDatabase.onModuleDestroy()
})

test('metrics require a bearer secret and contain operational gauges only', async () => {
  await request(app.getHttpServer()).get('/api/v1/health/metrics').expect(401)
  const response = await request(app.getHttpServer())
    .get('/api/v1/health/metrics')
    .set('Authorization', `Bearer ${metricsToken}`)
    .expect(200)
  assert.match(response.text, /aisidequest_active_sessions 2/)
  assert.match(response.text, /aisidequest_plugin_dead_letters 7/)
  assert.match(response.text, /aisidequest_discover_source_item_count\{source="HACKER_NEWS"\} 12/)
  assert.match(response.text, /aisidequest_discover_product_events_30d\{event="DISCOVER_VIEW",source="NONE",category="NONE"\} 3/)
  assert.doesNotMatch(response.text, /token|cookie|authorization/i)
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

test('operational event sanitizer drops forbidden fields and redacts values', () => {
  const sanitized = sanitizeOperationalEvent({
    event: 'sample',
    requestId: 'request-1234',
    route: '/safe',
    token: 'must-not-remain',
    error: 'Bearer must-not-remain at C:\\private\\source.ts',
  })
  const serialized = JSON.stringify(sanitized)
  assert.doesNotMatch(serialized, /must-not-remain|private|source\.ts/)
  assert.doesNotMatch(serialized, /"token"/)
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
  assert.equal(environment.GITHUB_DISCOVER_TOKEN, '')
  assert.deepEqual(environment.GITHUB_DISCOVER_ORGANIZATIONS, [])
  assert.deepEqual(environment.GITHUB_DISCOVER_REPOSITORIES, [])
  assert.equal(
    environment.GITHUB_CALLBACK_URL,
    'http://localhost:3000/api/v1/auth/github/callback',
  )
  assert.equal(environment.AUTH_SESSION_TTL_HOURS, 168)
  assert.equal(environment.DEPLOYMENT_ENVIRONMENT, 'local')
  assert.equal(environment.SERVICE_VERSION, '0.1.0')
  assert.equal(environment.TRUST_PROXY_HOPS, 0)
  assert.equal(environment.INTEGRATION_EVENTS_ENABLED, true)
  assert.equal(environment.QUEST_REWARDS_ENABLED, true)
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
    () => validateEnvironment({ GITHUB_DISCOVER_TOKEN: 'github_pat_server_only_test_token' }),
    /must be configured together/,
  )
  assert.throws(
    () => validateEnvironment({
      GITHUB_DISCOVER_TOKEN: 'github_pat_server_only_test_token',
      GITHUB_DISCOVER_REPOSITORIES: 'invalid-repository',
    }),
    /owner\/repository/,
  )
  const githubDiscover = validateEnvironment({
    GITHUB_DISCOVER_TOKEN: 'github_pat_server_only_test_token',
    GITHUB_DISCOVER_ORGANIZATIONS: 'OpenAI,Example-Org',
    GITHUB_DISCOVER_REPOSITORIES: 'OpenAI/Codex',
  })
  assert.deepEqual(githubDiscover.GITHUB_DISCOVER_ORGANIZATIONS, ['openai', 'example-org'])
  assert.deepEqual(githubDiscover.GITHUB_DISCOVER_REPOSITORIES, ['openai/codex'])
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

  const production = validateEnvironment({
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: 'staging',
    SERVICE_VERSION: 'git-abcdef123',
    TRUST_PROXY_HOPS: '1',
    METRICS_BEARER_TOKEN: 'm'.repeat(43),
    INTEGRATION_EVENTS_ENABLED: 'true',
    QUEST_REWARDS_ENABLED: 'true',
    DATABASE_URL: 'postgresql://app:strong-password@db.example.com/app',
    DATABASE_SSL: 'true',
    GITHUB_CLIENT_ID: 'client',
    GITHUB_CLIENT_SECRET: 'secret',
    GITHUB_CALLBACK_URL: 'https://example.com/api/v1/auth/github/callback',
    AUTH_SUCCESS_REDIRECT_URL: 'https://example.com/',
    AUTH_FAILURE_REDIRECT_URL: 'https://example.com/login-failed',
    CORS_ORIGIN: 'https://example.com',
  })
  assert.equal(production.DEPLOYMENT_ENVIRONMENT, 'staging')
  assert.equal(production.DATABASE_SSL, true)
  assert.equal(production.TRUST_PROXY_HOPS, 1)
})
