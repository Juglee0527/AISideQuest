import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'

import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { DataSource } from 'typeorm'

import { AppModule } from '../../src/app.module'
import { hashToken } from '../../src/auth/auth-crypto'
import { configureApplication } from '../../src/bootstrap/configure-application'
import { validateEnvironment } from '../../src/config/environment'
import { createDataSourceOptions } from '../../src/database/data-source'
import { DatabaseService } from '../../src/database/database.service'
import { SessionRecoveryService } from '../../src/sessions/session-recovery.service'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseResetAllowed = process.env.ALLOW_DATABASE_RESET === 'true'
const SESSION_KEY = 'a'.repeat(64)
const FIRST_TURN_KEY = 'b'.repeat(64)
const SECOND_TURN_KEY = 'c'.repeat(64)

interface TestIdentity {
  userId: string
  sessionToken: string
  csrfToken: string
}

function cookieHeader(identity: TestIdentity) {
  return [
    `aisidequest_session=${identity.sessionToken}`,
    `aisidequest_csrf=${identity.csrfToken}`,
  ].join('; ')
}

if (!testDatabaseUrl || !databaseResetAllowed) {
  test(
    'session integration tests require an explicitly resettable test database',
    { skip: 'Set TEST_DATABASE_URL and ALLOW_DATABASE_RESET=true' },
    () => undefined,
  )
} else {
  const parsedDatabaseUrl = new URL(testDatabaseUrl)
  const databaseName = parsedDatabaseUrl.pathname.slice(1)
  const environment = {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl,
    DATABASE_SSL: 'false',
    GITHUB_CLIENT_ID: 'test-github-client',
    GITHUB_CLIENT_SECRET: 'test-github-secret',
    GITHUB_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/github/callback',
    AUTH_SUCCESS_REDIRECT_URL: 'http://localhost:5173/',
    AUTH_FAILURE_REDIRECT_URL:
      'http://localhost:5173/?authError=github_oauth_failed',
    AUTH_SESSION_TTL_HOURS: '168',
  }
  const firstIdentity: TestIdentity = {
    userId: '',
    sessionToken: 'first-user-session-token',
    csrfToken: 'first-user-csrf-token',
  }
  const secondIdentity: TestIdentity = {
    userId: '',
    sessionToken: 'second-user-session-token',
    csrfToken: 'second-user-csrf-token',
  }
  const deviceToken = 'codex-device-token'
  let app: INestApplication
  let databaseService: DatabaseService
  let sessionRecoveryService: SessionRecoveryService

  before(async () => {
    assert.match(
      databaseName,
      /test/i,
      'TEST_DATABASE_URL database name must contain "test"',
    )

    const setupDataSource = new DataSource(
      createDataSourceOptions({
        DATABASE_URL: testDatabaseUrl,
        DATABASE_SSL: false,
      }),
    )
    await setupDataSource.initialize()
    await setupDataSource.dropDatabase()
    await setupDataSource.runMigrations()
    await setupDataSource.destroy()

    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(validateEnvironment(environment)))
      .compile()

    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.init()
    databaseService = app.get(DatabaseService)
    sessionRecoveryService = app.get(SessionRecoveryService)

    const users = await databaseService.query<Array<{ id: string }>>(
      `
        INSERT INTO users (display_name)
        VALUES ('First session user'), ('Second session user')
        RETURNING id
      `,
    )
    assert.equal(users.length, 2)
    firstIdentity.userId = users[0].id
    secondIdentity.userId = users[1].id

    await databaseService.query(
      `
        INSERT INTO user_auth_accounts (
          user_id, provider, provider_account_id, provider_login
        )
        VALUES
          ($1, 'GITHUB', 'session-user-1', 'session-user-1'),
          ($2, 'GITHUB', 'session-user-2', 'session-user-2')
      `,
      [firstIdentity.userId, secondIdentity.userId],
    )
    await databaseService.query(
      `
        INSERT INTO auth_sessions (
          user_id, token_hash, csrf_token_hash, expires_at
        )
        VALUES
          ($1, $2, $3, now() + interval '1 day'),
          ($4, $5, $6, now() + interval '1 day')
      `,
      [
        firstIdentity.userId,
        hashToken(firstIdentity.sessionToken),
        hashToken(firstIdentity.csrfToken),
        secondIdentity.userId,
        hashToken(secondIdentity.sessionToken),
        hashToken(secondIdentity.csrfToken),
      ],
    )
    await databaseService.query(
      `
        INSERT INTO devices (user_id, name, token_hash, expires_at)
        VALUES ($1, 'Session integration device', $2, now() + interval '1 day')
      `,
      [firstIdentity.userId, hashToken(deviceToken)],
    )
  })

  beforeEach(async () => {
    await databaseService.query(
      `
        DELETE FROM integration_events;
        DELETE FROM api_idempotency_keys;
        DELETE FROM ai_sessions;
      `,
    )
  })

  after(async () => {
    await app?.close()
  })

  function startManual(
    identity: TestIdentity,
    idempotencyKey: string,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/sessions/manual')
      .set('Cookie', cookieHeader(identity))
      .set('x-csrf-token', identity.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
  }

  function endSession(
    identity: TestIdentity,
    sessionId: string,
    outcome: 'COMPLETED' | 'FAILED' | 'ABANDONED',
    idempotencyKey: string,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/end`)
      .set('Cookie', cookieHeader(identity))
      .set('x-csrf-token', identity.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send({ outcome })
  }

  function sendIntegrationEvent(options: {
    event: string
    eventId?: string
    sessionKey?: string
    turnKey?: string | null
    observedAt?: string
    body?: Record<string, unknown>
    token?: string
  }) {
    const eventId = options.eventId ?? randomUUID()
    const body = {
      schemaVersion: 1,
      eventId,
      provider: 'CODEX',
      event: options.event,
      sessionKey: options.sessionKey ?? SESSION_KEY,
      turnKey: options.turnKey === undefined ? FIRST_TURN_KEY : options.turnKey,
      observedAt: options.observedAt ?? new Date().toISOString(),
      ...options.body,
    }

    return {
      eventId,
      request: request(app.getHttpServer())
        .post('/api/v1/integration-events')
        .set('Authorization', `Bearer ${options.token ?? deviceToken}`)
        .set('Idempotency-Key', eventId)
        .send(body),
    }
  }

  test('manual session mutations require authentication, CSRF and idempotency', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/sessions/manual')
      .set('Idempotency-Key', randomUUID())
      .expect(401)

    await request(app.getHttpServer())
      .post('/api/v1/sessions/manual')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('Idempotency-Key', randomUUID())
      .expect(403)

    const missingKey = await request(app.getHttpServer())
      .post('/api/v1/sessions/manual')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .expect(400)
    assert.equal(missingKey.body.error.code, 'VALIDATION_ERROR')

    const unexpectedBody = await startManual(firstIdentity, randomUUID())
      .send({ unexpected: true })
      .expect(400)
    assert.equal(unexpectedBody.body.error.code, 'VALIDATION_ERROR')
  })

  test('manual start replays the stored response for the same key', async () => {
    const idempotencyKey = randomUUID()
    const first = await startManual(firstIdentity, idempotencyKey).expect(200)
    const replay = await startManual(firstIdentity, idempotencyKey).expect(200)

    assert.equal(first.body.data.created, true)
    assert.equal(first.body.data.session.status, 'RUNNING')
    assert.equal(first.body.data.session.origin, 'MANUAL')
    assert.deepEqual(replay.body.data, first.body.data)

    const [counts] = await databaseService.query<
      Array<{ sessions: number; idempotency_keys: number }>
    >(`
      SELECT
        (SELECT count(*)::integer FROM ai_sessions) AS sessions,
        (
          SELECT count(*)::integer FROM api_idempotency_keys
        ) AS idempotency_keys
    `)
    assert.deepEqual(counts, { sessions: 1, idempotency_keys: 1 })
  })

  test('concurrent manual starts return one shared active session', async () => {
    const [first, second] = await Promise.all([
      startManual(firstIdentity, randomUUID()),
      startManual(firstIdentity, randomUUID()),
    ])

    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.deepEqual(
      [first.body.data.created, second.body.data.created].sort(),
      [false, true],
    )
    assert.equal(first.body.data.session.id, second.body.data.session.id)

    const [activeCount] = await databaseService.query<
      Array<{ count: number }>
    >(`
      SELECT count(*)::integer AS count
      FROM ai_sessions
      WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
    `)
    assert.equal(activeCount.count, 1)
  })

  test('manual end enforces ownership and idempotency without changing terminal state', async () => {
    const started = await startManual(firstIdentity, randomUUID()).expect(200)
    const sessionId = started.body.data.session.id as string
    const endKey = randomUUID()
    const ended = await endSession(
      firstIdentity,
      sessionId,
      'COMPLETED',
      endKey,
    ).expect(200)
    const replay = await endSession(
      firstIdentity,
      sessionId,
      'COMPLETED',
      endKey,
    ).expect(200)

    assert.equal(ended.body.data.session.status, 'COMPLETED')
    assert.equal(
      ended.body.data.session.terminalReason,
      'MANUAL_COMPLETED',
    )
    assert.deepEqual(replay.body.data, ended.body.data)

    const reusedKey = await endSession(
      firstIdentity,
      sessionId,
      'FAILED',
      endKey,
    ).expect(409)
    assert.equal(reusedKey.body.error.code, 'IDEMPOTENCY_KEY_REUSED')

    const otherUser = await endSession(
      secondIdentity,
      sessionId,
      'FAILED',
      randomUUID(),
    ).expect(404)
    assert.equal(otherUser.body.error.code, 'SESSION_NOT_FOUND')

    const terminalRetry = await endSession(
      firstIdentity,
      sessionId,
      'FAILED',
      randomUUID(),
    ).expect(200)
    assert.equal(terminalRetry.body.data.session.status, 'COMPLETED')

    const active = await request(app.getHttpServer())
      .get('/api/v1/sessions/active')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(active.body.data, null)
  })

  test('session history uses a stable cursor and optional status filter', async () => {
    const outcomes = ['COMPLETED', 'FAILED', 'ABANDONED'] as const

    for (const outcome of outcomes) {
      const started = await startManual(firstIdentity, randomUUID()).expect(200)
      await endSession(
        firstIdentity,
        started.body.data.session.id,
        outcome,
        randomUUID(),
      ).expect(200)
    }

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/sessions')
      .query({ limit: 2 })
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(firstPage.body.data.items.length, 2)
    assert.equal(typeof firstPage.body.data.nextCursor, 'string')

    const secondPage = await request(app.getHttpServer())
      .get('/api/v1/sessions')
      .query({ limit: 2, cursor: firstPage.body.data.nextCursor })
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(secondPage.body.data.items.length, 1)
    assert.equal(secondPage.body.data.nextCursor, null)

    const ids = [
      ...firstPage.body.data.items,
      ...secondPage.body.data.items,
    ].map((session: { id: string }) => session.id)
    assert.equal(new Set(ids).size, 3)

    const completedOnly = await request(app.getHttpServer())
      .get('/api/v1/sessions')
      .query({ status: 'COMPLETED' })
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(completedOnly.body.data.items.length, 1)
    assert.equal(completedOnly.body.data.items[0].status, 'COMPLETED')

    await request(app.getHttpServer())
      .get('/api/v1/sessions')
      .query({ cursor: 'not-a-valid-cursor' })
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(400)
  })

  test('Codex events transition one session and replay duplicate events', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/integration-events')
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(401)

    const startObservedAt = new Date().toISOString()
    const startEvent = sendIntegrationEvent({
      event: 'UserPromptSubmit',
      observedAt: startObservedAt,
    })
    const started = await startEvent.request.expect(200)
    assert.equal(started.body.data.result, 'APPLIED')
    assert.equal(started.body.data.session.status, 'RUNNING')
    assert.equal(started.body.data.session.origin, 'HOOK')

    const duplicate = sendIntegrationEvent({
      event: 'UserPromptSubmit',
      eventId: startEvent.eventId,
      observedAt: startObservedAt,
    })
    const replay = await duplicate.request.expect(200)
    assert.deepEqual(replay.body.data, started.body.data)

    const semanticDuplicate = await sendIntegrationEvent({
      event: 'UserPromptSubmit',
    }).request.expect(200)
    assert.equal(semanticDuplicate.body.data.result, 'DUPLICATE')
    assert.equal(
      semanticDuplicate.body.data.session.id,
      started.body.data.session.id,
    )

    const changedPayload = sendIntegrationEvent({
      event: 'UserPromptSubmit',
      eventId: startEvent.eventId,
      sessionKey: 'd'.repeat(64),
      observedAt: startObservedAt,
    })
    const conflict = await changedPayload.request.expect(409)
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_REUSED')

    const waiting = await sendIntegrationEvent({
      event: 'PermissionRequest',
    }).request.expect(200)
    assert.equal(waiting.body.data.session.status, 'WAITING_FOR_USER')

    const running = await sendIntegrationEvent({
      event: 'PostToolUse',
    }).request.expect(200)
    assert.equal(running.body.data.session.status, 'RUNNING')

    const stopped = await sendIntegrationEvent({
      event: 'Stop',
    }).request.expect(200)
    assert.equal(stopped.body.data.session.status, 'COMPLETED')
    assert.equal(stopped.body.data.session.terminalReason, 'HOOK_STOP')

    const active = await request(app.getHttpServer())
      .get('/api/v1/sessions/active')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(active.body.data, null)
  })

  test('automatic start links a manual session and a new turn supersedes it', async () => {
    const manual = await startManual(firstIdentity, randomUUID()).expect(200)
    const manualSessionId = manual.body.data.session.id as string

    const linked = await sendIntegrationEvent({
      event: 'UserPromptSubmit',
    }).request.expect(200)
    assert.equal(linked.body.data.session.id, manualSessionId)
    assert.equal(linked.body.data.session.origin, 'MANUAL')
    assert.equal(linked.body.data.session.autoLinked, true)

    const superseding = await sendIntegrationEvent({
      event: 'UserPromptSubmit',
      turnKey: SECOND_TURN_KEY,
    }).request.expect(200)
    assert.notEqual(superseding.body.data.session.id, manualSessionId)
    assert.equal(superseding.body.data.session.origin, 'HOOK')

    const [previous] = await databaseService.query<
      Array<{ status: string; terminal_reason: string }>
    >(
      `
        SELECT status, terminal_reason
        FROM ai_sessions
        WHERE id = $1
      `,
      [manualSessionId],
    )
    assert.deepEqual(previous, {
      status: 'ABANDONED',
      terminal_reason: 'SUPERSEDED_BY_NEW_TURN',
    })
  })

  test('a Stop received before start is deferred and reapplied with degraded timing', async () => {
    const stopObservedAt = new Date().toISOString()
    const stopEvent = sendIntegrationEvent({
      event: 'Stop',
      observedAt: stopObservedAt,
    })
    const deferred = await stopEvent.request.expect(200)
    assert.equal(deferred.body.data.result, 'DEFERRED')
    assert.equal(deferred.body.data.session, null)

    const started = await sendIntegrationEvent({
      event: 'UserPromptSubmit',
    }).request.expect(200)
    assert.equal(started.body.data.session.status, 'COMPLETED')
    assert.equal(started.body.data.session.timingQuality, 'DEGRADED')
    assert.equal(started.body.data.session.durationMs, 0)

    const stopReplay = await sendIntegrationEvent({
      event: 'Stop',
      eventId: stopEvent.eventId,
      observedAt: stopObservedAt,
    }).request.expect(200)
    assert.equal(stopReplay.body.data.result, 'APPLIED')
    assert.equal(stopReplay.body.data.session.status, 'COMPLETED')
  })

  test('integration input validation rejects unsupported, private and unsafe data', async () => {
    await databaseService.query(
      'UPDATE devices SET last_seen_at = NULL WHERE user_id = $1',
      [firstIdentity.userId],
    )

    const unsupported = await sendIntegrationEvent({
      event: 'UnknownHook',
    }).request.expect(422)
    assert.equal(unsupported.body.error.code, 'UNSUPPORTED_EVENT')

    const missingTurn = await sendIntegrationEvent({
      event: 'Heartbeat',
      turnKey: null,
    }).request.expect(400)
    assert.equal(missingTurn.body.error.code, 'VALIDATION_ERROR')

    await sendIntegrationEvent({
      event: 'Heartbeat',
      observedAt: new Date(Date.now() + 6 * 60 * 1_000).toISOString(),
    }).request.expect(400)

    const privateField = await sendIntegrationEvent({
      event: 'Heartbeat',
      body: { prompt: 'must not be accepted' },
    }).request.expect(400)
    assert.equal(privateField.body.error.code, 'VALIDATION_ERROR')

    const [device] = await databaseService.query<
      Array<{ last_seen_at: Date | null }>
    >('SELECT last_seen_at FROM devices WHERE user_id = $1', [
      firstIdentity.userId,
    ])
    assert.equal(device.last_seen_at, null)
  })

  test('device event sequence is unique and included in idempotency hashing', async () => {
    const eventId = randomUUID()
    const first = await sendIntegrationEvent({
      event: 'SessionStart',
      eventId,
      turnKey: null,
      body: { sequence: 1 },
    }).request.expect(200)
    assert.equal(first.body.data.result, 'APPLIED')

    await sendIntegrationEvent({
      event: 'SessionStart',
      eventId,
      turnKey: null,
      body: { sequence: 2 },
    }).request.expect(409)

    const reused = await sendIntegrationEvent({
      event: 'SessionStart',
      turnKey: null,
      body: { sequence: 1 },
    }).request.expect(409)
    assert.equal(reused.body.error.code, 'DEVICE_SEQUENCE_REUSED')
  })

  test('recovery cleanup expires automatic and manual sessions at fixed boundaries and ignores orphan events', async () => {
    const automatic = await sendIntegrationEvent({
      event: 'UserPromptSubmit',
    }).request.expect(200)
    const automaticId = automatic.body.data.session.id as string
    await databaseService.query(
      `UPDATE ai_sessions
       SET started_at = clock_timestamp() - interval '10 minutes',
           last_activity_at = clock_timestamp() - interval '3 minutes'
       WHERE id = $1`,
      [automaticId],
    )

    const manual = await startManual(secondIdentity, randomUUID()).expect(200)
    const manualId = manual.body.data.session.id as string
    await databaseService.query(
      `UPDATE ai_sessions
       SET started_at = clock_timestamp() - interval '13 hours',
           last_activity_at = clock_timestamp() - interval '13 hours'
       WHERE id = $1`,
      [manualId],
    )

    const orphan = sendIntegrationEvent({
      event: 'Stop',
      turnKey: SECOND_TURN_KEY,
    })
    await orphan.request.expect(200)
    await databaseService.query(
      `UPDATE integration_events
       SET received_at = clock_timestamp() - interval '25 hours'
       WHERE event_id = $1`,
      [orphan.eventId],
    )

    const result = await sessionRecoveryService.runCleanup()
    assert.deepEqual(result, {
      skipped: false,
      automaticSessionsExpired: 1,
      manualSessionsExpired: 1,
      orphanEventsIgnored: 1,
    })

    const sessions = await databaseService.query<Array<{
      id: string
      terminal_reason: string
      duration_seconds: number
    }>>(
      `SELECT id, terminal_reason,
              extract(epoch FROM ended_at - CASE
                WHEN id = $1 THEN last_activity_at
                ELSE started_at
              END)::integer AS duration_seconds
       FROM ai_sessions
       WHERE id IN ($1, $2)
       ORDER BY id`,
      [automaticId, manualId],
    )
    const byId = new Map(sessions.map((session) => [session.id, session]))
    assert.equal(byId.get(automaticId)?.terminal_reason, 'HEARTBEAT_TIMEOUT')
    assert.equal(byId.get(automaticId)?.duration_seconds, 120)
    assert.equal(byId.get(manualId)?.terminal_reason, 'MANUAL_TIMEOUT')
    assert.equal(byId.get(manualId)?.duration_seconds, 43_200)

    const [ignored] = await databaseService.query<Array<{
      processing_result: string
      response_body: { result: string }
    }>>(
      'SELECT processing_result, response_body FROM integration_events WHERE event_id = $1',
      [orphan.eventId],
    )
    assert.equal(ignored.processing_result, 'IGNORED_ORPHAN')
    assert.equal(ignored.response_body.result, 'IGNORED_ORPHAN')
  })

  test('a same-device late Stop recovers only a heartbeat timeout and preserves endedAt', async () => {
    const started = await sendIntegrationEvent({
      event: 'UserPromptSubmit',
    }).request.expect(200)
    const sessionId = started.body.data.session.id as string
    await databaseService.query(
      `UPDATE ai_sessions
       SET started_at = clock_timestamp() - interval '10 minutes',
           last_activity_at = clock_timestamp() - interval '3 minutes'
       WHERE id = $1`,
      [sessionId],
    )
    await sessionRecoveryService.runCleanup()

    const [timedOut] = await databaseService.query<Array<{ ended_at: Date }>>(
      'SELECT ended_at FROM ai_sessions WHERE id = $1',
      [sessionId],
    )
    const stopped = await sendIntegrationEvent({
      event: 'Stop',
    }).request.expect(200)

    assert.equal(stopped.body.data.session.status, 'COMPLETED')
    assert.equal(stopped.body.data.session.terminalReason, 'RECOVERED_LATE_STOP')
    assert.equal(stopped.body.data.session.timingQuality, 'DEGRADED')
    assert.equal(stopped.body.data.session.endedAt, timedOut.ended_at.toISOString())
  })
}
