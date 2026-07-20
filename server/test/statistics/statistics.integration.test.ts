import assert from 'node:assert/strict'
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
import { seedDevelopmentQuests } from '../../src/database/seeds/development-quests'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseResetAllowed = process.env.ALLOW_DATABASE_RESET === 'true'

if (!testDatabaseUrl || !databaseResetAllowed) {
  test('statistics integration tests require an explicitly resettable test database', {
    skip: 'Set TEST_DATABASE_URL and ALLOW_DATABASE_RESET=true',
  }, () => undefined)
} else {
  const environment = {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl,
    DATABASE_SSL: 'false',
    GITHUB_CLIENT_ID: 'test-github-client',
    GITHUB_CLIENT_SECRET: 'test-github-secret',
    GITHUB_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/github/callback',
    AUTH_SUCCESS_REDIRECT_URL: 'http://localhost:5173/',
    AUTH_FAILURE_REDIRECT_URL: 'http://localhost:5173/?authError=github_oauth_failed',
    AUTH_SESSION_TTL_HOURS: '168',
  }
  const sessionToken = 'statistics-session'
  const otherSessionToken = 'statistics-other-session'
  let app: INestApplication
  let database: DatabaseService
  let userId: string
  let otherUserId: string

  before(async () => {
    assert.match(new URL(testDatabaseUrl).pathname.slice(1), /test/i)
    const setup = new DataSource(createDataSourceOptions({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_SSL: false,
    }))
    await setup.initialize()
    await setup.dropDatabase()
    await setup.runMigrations()
    await seedDevelopmentQuests(setup)
    await setup.destroy()

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(validateEnvironment(environment)))
      .compile()
    app = module.createNestApplication()
    configureApplication(app)
    await app.init()
    database = app.get(DatabaseService)

    const users = await database.query<Array<{ id: string }>>(`
      INSERT INTO users (display_name, time_zone, time_zone_verified)
      VALUES ('Statistics user', 'Asia/Seoul', true),
             ('Other statistics user', 'UTC', true)
      RETURNING id
    `)
    userId = users[0].id
    otherUserId = users[1].id
    await database.query(`
      INSERT INTO user_auth_accounts (
        user_id, provider, provider_account_id, provider_login
      ) VALUES ($1, 'GITHUB', 'statistics', 'statistics'),
               ($2, 'GITHUB', 'statistics-other', 'statistics-other')
    `, [userId, otherUserId])
    await database.query(`
      INSERT INTO auth_sessions (user_id, token_hash, csrf_token_hash, expires_at)
      VALUES ($1, $2, $3, now() + interval '1 day'),
             ($4, $5, $6, now() + interval '1 day')
    `, [
      userId, hashToken(sessionToken), hashToken('statistics-csrf'),
      otherUserId, hashToken(otherSessionToken), hashToken('statistics-other-csrf'),
    ])
  })

  beforeEach(async () => {
    await database.query('DELETE FROM point_ledger')
    await database.query('DELETE FROM quest_attempts')
    await database.query('DELETE FROM ai_sessions')
    await database.query(
      "UPDATE users SET time_zone = 'Asia/Seoul', time_zone_verified = true WHERE id = $1",
      [userId],
    )
  })

  after(async () => app?.close())

  function cookie(token = sessionToken) {
    return `aisidequest_session=${token}`
  }

  async function createReward(questCode: string, createdAt: string) {
    const [quest] = await database.query<Array<{ id: string }>>(
      'SELECT id FROM quests WHERE code = $1',
      [questCode],
    )
    const [session] = await database.query<Array<{ id: string }>>(`
      INSERT INTO ai_sessions (
        user_id, status, origin, started_at, ended_at,
        last_activity_at, terminal_reason
      ) VALUES ($1, 'COMPLETED', 'MANUAL', $2::timestamptz - interval '1 minute',
                $2, $2, 'MANUAL_COMPLETED')
      RETURNING id
    `, [userId, createdAt])
    const [attempt] = await database.query<Array<{ id: string }>>(`
      INSERT INTO quest_attempts (
        user_id, quest_id, ai_session_id, status, started_at,
        submitted_at, completed_at, score, passed, reward_points_snapshot
      ) VALUES ($1, $2, $3, 'COMPLETED', $4::timestamptz - interval '1 minute',
                $4, $4, 100, true, 100)
      RETURNING id
    `, [userId, quest.id, session.id, createdAt])
    await database.query(`
      INSERT INTO point_ledger (
        user_id, quest_id, quest_attempt_id, entry_type,
        points, description, created_at
      ) VALUES ($1, $2, $3, 'QUEST_REWARD', 100, 'Statistics reward', $4)
    `, [userId, quest.id, attempt.id, createdAt])
  }

  test('aggregates overlapping sessions, degraded quality, quests and points at one server time', async () => {
    await request(app.getHttpServer()).get('/api/v1/stats/summary?period=today').expect(401)
    const [clock] = await database.query<Array<{ day_start: Date; now: Date }>>(`
      SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS day_start,
             now() AS now
    `)
    await database.query(`
      INSERT INTO ai_sessions (
        user_id, status, origin, started_at, ended_at,
        last_activity_at, terminal_reason, timing_quality
      ) VALUES
        ($1, 'COMPLETED', 'MANUAL', $2::timestamptz - interval '1 hour',
         $2::timestamptz + interval '2 hours', $2::timestamptz + interval '2 hours',
         'MANUAL_COMPLETED', 'EXACT'),
        ($1, 'COMPLETED', 'MANUAL', $3::timestamptz - interval '20 minutes',
         $3::timestamptz - interval '10 minutes', $3::timestamptz - interval '10 minutes',
         'MANUAL_COMPLETED', 'DEGRADED'),
        ($1, 'RUNNING', 'MANUAL', $3::timestamptz - interval '5 minutes',
         NULL, $3::timestamptz, NULL, 'EXACT')
    `, [userId, clock.day_start, clock.now])
    await createReward('typescript-type-narrowing', clock.now.toISOString())
    await createReward('http-idempotency', new Date(clock.now.getTime() - 1_000).toISOString())

    const response = await request(app.getHttpServer())
      .get('/api/v1/stats/summary?period=today')
      .set('Cookie', cookie())
      .expect(200)
    assert.equal(response.body.meta.serverTime, response.body.data.asOf)
    assert.equal(response.body.data.timeZone.id, 'Asia/Seoul')
    assert.equal(response.body.data.ai.sessionCount, 5)
    assert.equal(response.body.data.ai.degradedSessionCount, 1)
    assert.equal(response.body.data.quests.completedCount, 2)
    assert.equal(response.body.data.points.earned, 200)
    assert.ok(response.body.data.ai.waitDurationMs >= 15 * 60 * 1_000)

    const other = await request(app.getHttpServer())
      .get('/api/v1/stats/summary?period=today')
      .set('Cookie', cookie(otherSessionToken))
      .expect(200)
    assert.equal(other.body.data.ai.sessionCount, 0)
    assert.equal(other.body.data.points.earned, 0)
  })

  test('uses IANA local half-open boundaries across DST and calendar transitions', async () => {
    const [boundaries] = await database.query<Array<{
      spring_hours: number
      fall_hours: number
      january_start: Date
      week_start: Date
    }>>(`
      SELECT
        extract(epoch FROM (
          (timestamp '2026-03-09 00:00' AT TIME ZONE 'America/New_York')
          - (timestamp '2026-03-08 00:00' AT TIME ZONE 'America/New_York')
        )) / 3600 AS spring_hours,
        extract(epoch FROM (
          (timestamp '2026-11-02 00:00' AT TIME ZONE 'America/New_York')
          - (timestamp '2026-11-01 00:00' AT TIME ZONE 'America/New_York')
        )) / 3600 AS fall_hours,
        date_trunc('month', timestamptz '2026-01-01 12:00+00' AT TIME ZONE 'Asia/Seoul')
          AT TIME ZONE 'Asia/Seoul' AS january_start,
        date_trunc('week', timestamptz '2026-01-01 12:00+00' AT TIME ZONE 'Asia/Seoul')
          AT TIME ZONE 'Asia/Seoul' AS week_start
    `)
    assert.equal(Number(boundaries.spring_hours), 23)
    assert.equal(Number(boundaries.fall_hours), 25)
    assert.equal(boundaries.january_start.toISOString(), '2025-12-31T15:00:00.000Z')
    assert.equal(boundaries.week_start.toISOString(), '2025-12-28T15:00:00.000Z')

    await request(app.getHttpServer())
      .get('/api/v1/stats/summary?period=custom&start=2026-01-01&end=2027-01-03')
      .set('Cookie', cookie())
      .expect(400)
    await request(app.getHttpServer())
      .get('/api/v1/stats/summary?period=custom&start=2026-02-30&end=2026-03-02')
      .set('Cookie', cookie())
      .expect(400)
  })

  test('paginates owned mixed activity with a stable cursor', async () => {
    const now = new Date()
    await createReward('typescript-type-narrowing', now.toISOString())
    await database.query(`
      INSERT INTO ai_sessions (
        user_id, status, origin, started_at, ended_at,
        last_activity_at, terminal_reason
      ) VALUES ($1, 'COMPLETED', 'MANUAL', $2::timestamptz - interval '2 minutes',
                $2, $2, 'MANUAL_COMPLETED')
    `, [userId, new Date(now.getTime() - 5_000).toISOString()])

    const first = await request(app.getHttpServer())
      .get('/api/v1/stats/activity?period=today&limit=1')
      .set('Cookie', cookie())
      .expect(200)
    assert.equal(first.body.meta.serverTime, first.body.data.asOf)
    assert.equal(first.body.data.items.length, 1)
    assert.ok(first.body.data.nextCursor)
    const second = await request(app.getHttpServer())
      .get(`/api/v1/stats/activity?period=today&limit=1&cursor=${encodeURIComponent(first.body.data.nextCursor)}`)
      .set('Cookie', cookie())
      .expect(200)
    assert.equal(second.body.data.items.length, 1)
    assert.notEqual(first.body.data.items[0].id, second.body.data.items[0].id)
  })

  test('statistics interval indexes support selective large-user plans', async () => {
    await database.query(`
      INSERT INTO ai_sessions (
        user_id, status, origin, started_at, ended_at,
        last_activity_at, terminal_reason
      )
      SELECT $1, 'COMPLETED', 'MANUAL',
             now() - make_interval(mins => series + 2),
             now() - make_interval(mins => series + 1),
             now() - make_interval(mins => series + 1),
             'MANUAL_COMPLETED'
      FROM generate_series(1, 3000) series
    `, [otherUserId])
    const plan = await database.query<Array<{ 'QUERY PLAN': string }>>(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT id FROM ai_sessions
      WHERE user_id = $1
        AND started_at < now()
        AND COALESCE(ended_at, now()) > now() - interval '1 day'
    `, [userId])
    assert.match(plan.map((row) => row['QUERY PLAN']).join('\n'), /ix_ai_sessions_user_interval/)
  })
}
