import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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
import type { DiscoverItem } from '../../src/discover/discover.types'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseResetAllowed = process.env.ALLOW_DATABASE_RESET === 'true'

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

function discoverItem(id: string, publishedAt: string): DiscoverItem {
  return {
    id: `HACKER_NEWS:${id}`,
    source: 'HACKER_NEWS',
    category: 'NEWS',
    kind: 'ARTICLE',
    title: `Discover item ${id}`,
    summary: `Summary ${id}`,
    tags: ['typescript'],
    reward: null,
    compensation: null,
    engagement: null,
    readingTimeMinutes: null,
    originalUrl: `https://news.ycombinator.com/item?id=${id}`,
    attribution: 'Hacker News',
    publishedAt,
    fetchedAt: '2026-07-21T00:00:00.000Z',
  }
}

if (!testDatabaseUrl || !databaseResetAllowed) {
  test(
    'discover saved item integration tests require an explicitly resettable test database',
    { skip: 'Set TEST_DATABASE_URL and ALLOW_DATABASE_RESET=true' },
    () => undefined,
  )
} else {
  const parsedDatabaseUrl = new URL(testDatabaseUrl)
  const databaseName = parsedDatabaseUrl.pathname.slice(1)
  const firstIdentity: TestIdentity = {
    userId: '',
    sessionToken: 'discover-saved-first-session-token',
    csrfToken: 'discover-saved-first-csrf-token',
  }
  const secondIdentity: TestIdentity = {
    userId: '',
    sessionToken: 'discover-saved-second-session-token',
    csrfToken: 'discover-saved-second-csrf-token',
  }
  const items = [
    discoverItem('101', '2026-07-21T03:00:00.000Z'),
    discoverItem('102', '2026-07-21T02:00:00.000Z'),
  ]
  let app: INestApplication
  let databaseService: DatabaseService

  before(async () => {
    assert.match(databaseName, /test/i, 'TEST_DATABASE_URL database name must contain "test"')

    const setupDataSource = new DataSource(createDataSourceOptions({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_SSL: false,
    }))
    await setupDataSource.initialize()
    await setupDataSource.dropDatabase()
    await setupDataSource.runMigrations()
    await setupDataSource.destroy()

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
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(validateEnvironment(environment)))
      .compile()

    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.init()
    databaseService = app.get(DatabaseService)

    const users = await databaseService.query<Array<{ id: string }>>(`
      INSERT INTO users (display_name)
      VALUES ('Discover saved first user'), ('Discover saved second user')
      RETURNING id
    `)
    firstIdentity.userId = users[0].id
    secondIdentity.userId = users[1].id
    await databaseService.query(`
      INSERT INTO user_auth_accounts (
        user_id, provider, provider_account_id, provider_login
      ) VALUES
        ($1, 'GITHUB', 'discover-saved-user-1', 'discover-saved-user-1'),
        ($2, 'GITHUB', 'discover-saved-user-2', 'discover-saved-user-2')
    `, [firstIdentity.userId, secondIdentity.userId])
    await databaseService.query(`
      INSERT INTO auth_sessions (user_id, token_hash, csrf_token_hash, expires_at)
      VALUES
        ($1, $2, $3, now() + interval '1 day'),
        ($4, $5, $6, now() + interval '1 day')
    `, [
      firstIdentity.userId,
      hashToken(firstIdentity.sessionToken),
      hashToken(firstIdentity.csrfToken),
      secondIdentity.userId,
      hashToken(secondIdentity.sessionToken),
      hashToken(secondIdentity.csrfToken),
    ])
  })

  beforeEach(async () => {
    await databaseService.query(`
      DELETE FROM discover_analytics_events;
      DELETE FROM discover_user_interests;
      DELETE FROM discover_saved_items;
      DELETE FROM api_idempotency_keys;
      DELETE FROM discover_source_cache;
    `)
    await databaseService.query(`
      INSERT INTO discover_source_cache (source, items, refreshed_at)
      VALUES ('HACKER_NEWS', $1::jsonb, now())
    `, [JSON.stringify(items)])
  })

  after(async () => {
    await app?.close()
  })

  test('save requires auth, CSRF, and idempotency while duplicate saves reuse ownership', async () => {
    const replayKey = randomUUID()
    await request(app.getHttpServer())
      .post('/api/v1/discover/saved-items')
      .send({ itemId: items[0].id })
      .expect(401)

    await request(app.getHttpServer())
      .post('/api/v1/discover/saved-items')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: items[0].id })
      .expect(403)

    await request(app.getHttpServer())
      .post('/api/v1/discover/saved-items')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .send({ itemId: items[0].id })
      .expect(400)

    await request(app.getHttpServer())
      .post('/api/v1/discover/saved-items')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: 'HACKER_NEWS:999' })
      .expect(404)

    const saved = await request(app.getHttpServer())
      .post('/api/v1/discover/saved-items')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', replayKey)
      .send({ itemId: items[0].id })
      .expect(200)
    assert.equal(saved.body.data.created, true)
    assert.equal(saved.body.data.savedItem.item.id, items[0].id)

    const replay = await request(app.getHttpServer())
      .post('/api/v1/discover/saved-items')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', replayKey)
      .send({ itemId: items[0].id })
      .expect(200)
    assert.deepEqual(replay.body.data, saved.body.data)

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/discover/saved-items')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: items[0].id })
      .expect(200)
    assert.equal(duplicate.body.data.created, false)
    assert.equal(duplicate.body.data.savedItem.id, saved.body.data.savedItem.id)

    const [analyticsCount] = await databaseService.query<Array<{ count: number }>>(`
      SELECT count(*)::integer AS count
      FROM discover_analytics_events
      WHERE user_id = $1 AND event_name = 'SAVE'
    `, [firstIdentity.userId])
    assert.equal(analyticsCount.count, 1)

    const discover = await request(app.getHttpServer())
      .get('/api/v1/discover')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.deepEqual(discover.body.data.savedItems, [{
      itemId: items[0].id,
      savedItemId: saved.body.data.savedItem.id,
    }])
  })

  test('analytics accepts only privacy-bounded event dimensions and idempotent replay', async () => {
    const replayKey = randomUUID()
    await request(app.getHttpServer())
      .post('/api/v1/discover/events')
      .send({ eventName: 'DISCOVER_VIEW' })
      .expect(401)
    await request(app.getHttpServer())
      .post('/api/v1/discover/events')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('Idempotency-Key', randomUUID())
      .send({ eventName: 'DISCOVER_VIEW' })
      .expect(403)
    await request(app.getHttpServer())
      .post('/api/v1/discover/events')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ eventName: 'SAVE', source: 'REMOTIVE', category: 'EARNING' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/v1/discover/events')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ eventName: 'OUTBOUND_CLICK', source: 'REMOTIVE', category: 'EARNING', itemId: 'REMOTIVE:101' })
      .expect(400)

    const recorded = await request(app.getHttpServer())
      .post('/api/v1/discover/events')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', replayKey)
      .send({ eventName: 'TAB_VIEW', category: 'NEWS' })
      .expect(200)
    assert.deepEqual(recorded.body.data, { recorded: true })
    await request(app.getHttpServer())
      .post('/api/v1/discover/events')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', replayKey)
      .send({ eventName: 'TAB_VIEW', category: 'NEWS' })
      .expect(200)

    const rows = await databaseService.query<Array<{
      event_name: string
      source: string | null
      category: string | null
      retention_days: number
    }>>(`
      SELECT event_name, source, category,
             round(extract(epoch FROM expires_at - occurred_at) / 86400)::integer AS retention_days
      FROM discover_analytics_events
      WHERE user_id = $1
    `, [firstIdentity.userId])
    assert.deepEqual(rows, [{
      event_name: 'TAB_VIEW',
      source: null,
      category: 'NEWS',
      retention_days: 90,
    }])
  })

  test('pilot SQL de-duplicates users and repeat visits across exact UTC dates', async () => {
    const [thirdUser] = await databaseService.query<Array<{ id: string }>>(`
      INSERT INTO users (display_name) VALUES ('Discover pilot fixture user') RETURNING id
    `)
    const sessions = await databaseService.query<Array<{ id: string }>>(`
      INSERT INTO ai_sessions (
        user_id, status, origin, started_at, last_activity_at, ended_at, terminal_reason
      ) VALUES
        ($1, 'COMPLETED', 'MANUAL', '2026-08-01T01:00:00Z', '2026-08-01T01:05:00Z', '2026-08-01T01:05:00Z', 'MANUAL_COMPLETED'),
        ($2, 'COMPLETED', 'MANUAL', '2026-08-02T01:00:00Z', '2026-08-02T01:05:00Z', '2026-08-02T01:05:00Z', 'MANUAL_COMPLETED'),
        ($3, 'COMPLETED', 'MANUAL', '2026-08-03T01:00:00Z', '2026-08-03T01:05:00Z', '2026-08-03T01:05:00Z', 'MANUAL_COMPLETED')
      RETURNING id
    `, [firstIdentity.userId, secondIdentity.userId, thirdUser.id])

    try {
      await databaseService.query(`
        INSERT INTO discover_analytics_events (
          user_id, event_name, source, category, occurred_at, expires_at
        ) VALUES
          ($1, 'DISCOVER_VIEW', NULL, NULL, '2026-08-01T02:00:00Z', '2026-10-01T00:00:00Z'),
          ($1, 'DISCOVER_VIEW', NULL, NULL, '2026-08-02T02:00:00Z', '2026-10-01T00:00:00Z'),
          ($1, 'TAB_VIEW', NULL, 'NEWS', '2026-08-02T02:01:00Z', '2026-10-01T00:00:00Z'),
          ($1, 'TAB_VIEW', NULL, 'COMMUNITY', '2026-08-02T02:02:00Z', '2026-10-01T00:00:00Z'),
          ($1, 'OUTBOUND_CLICK', 'HACKER_NEWS', 'NEWS', '2026-08-02T02:03:00Z', '2026-10-01T00:00:00Z'),
          ($1, 'SAVE', 'HACKER_NEWS', 'NEWS', '2026-08-02T02:04:00Z', '2026-10-01T00:00:00Z'),
          ($2, 'DISCOVER_VIEW', NULL, NULL, '2026-08-03T02:00:00Z', '2026-10-01T00:00:00Z'),
          ($2, 'TAB_VIEW', NULL, 'EARNING', '2026-08-03T02:01:00Z', '2026-10-01T00:00:00Z')
      `, [firstIdentity.userId, secondIdentity.userId])

      const sql = await readFile('ops/discover-pilot-metrics.sql', 'utf8')
      const [result] = await databaseService.query<Array<Record<string, unknown>>>(sql, [
        '2026-08-01T00:00:00.000Z',
        '2026-08-08T00:00:00.000Z',
      ])
      assert.equal(result.ai_session_users, 3)
      assert.equal(result.discover_users, 2)
      assert.equal(result.outbound_users, 1)
      assert.equal(result.save_users, 1)
      assert.equal(result.repeat_users, 1)
      assert.equal(result.event_count, 8)
      assert.equal(Number(result.discover_entry_rate), 2 / 3)
      assert.equal(Number(result.outbound_rate), 0.5)
      assert.equal(Number(result.save_rate), 0.5)
      assert.equal(Number(result.repeat_visit_rate), 0.5)
      assert.ok(Array.isArray(result.event_breakdown))
      assert.ok(Array.isArray(result.hourly_event_breakdown))
    } finally {
      await databaseService.query('DELETE FROM ai_sessions WHERE id = ANY($1::uuid[])', [sessions.map((row) => row.id)])
      await databaseService.query('DELETE FROM users WHERE id = $1', [thirdUser.id])
    }
  })

  test('delete is ownership-scoped and safe to repeat', async () => {
    const deleteReplayKey = randomUUID()
    const saved = await request(app.getHttpServer())
      .post('/api/v1/discover/saved-items')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ itemId: items[0].id })
      .expect(200)
    const savedItemId = saved.body.data.savedItem.id as string

    const otherUserList = await request(app.getHttpServer())
      .get('/api/v1/discover/saved-items')
      .set('Cookie', cookieHeader(secondIdentity))
      .expect(200)
    assert.deepEqual(otherUserList.body.data.items, [])

    const otherUserDelete = await request(app.getHttpServer())
      .delete(`/api/v1/discover/saved-items/${savedItemId}`)
      .set('Cookie', cookieHeader(secondIdentity))
      .set('x-csrf-token', secondIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200)
    assert.equal(otherUserDelete.body.data.deleted, false)

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/discover/saved-items/${savedItemId}`)
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', deleteReplayKey)
      .send({})
      .expect(200)
    assert.deepEqual(deleted.body.data, { deleted: true, savedItemId })

    const replay = await request(app.getHttpServer())
      .delete(`/api/v1/discover/saved-items/${savedItemId}`)
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', deleteReplayKey)
      .send({})
      .expect(200)
    assert.deepEqual(replay.body.data, deleted.body.data)

    const repeated = await request(app.getHttpServer())
      .delete(`/api/v1/discover/saved-items/${savedItemId}`)
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200)
    assert.deepEqual(repeated.body.data, { deleted: false, savedItemId })
  })

  test('saved snapshots remain pageable after source cache loss', async () => {
    for (const item of items) {
      await request(app.getHttpServer())
        .post('/api/v1/discover/saved-items')
        .set('Cookie', cookieHeader(firstIdentity))
        .set('x-csrf-token', firstIdentity.csrfToken)
        .set('Idempotency-Key', randomUUID())
        .send({ itemId: item.id })
        .expect(200)
    }
    await databaseService.query('DELETE FROM discover_source_cache')

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/discover/saved-items?limit=1')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(firstPage.body.data.items.length, 1)
    assert.equal(typeof firstPage.body.data.nextCursor, 'string')

    const secondPage = await request(app.getHttpServer())
      .get('/api/v1/discover/saved-items')
      .query({ limit: 1, cursor: firstPage.body.data.nextCursor })
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(secondPage.body.data.items.length, 1)
    assert.equal(secondPage.body.data.nextCursor, null)
    assert.notEqual(secondPage.body.data.items[0].id, firstPage.body.data.items[0].id)

    await request(app.getHttpServer())
      .get('/api/v1/discover/saved-items?cursor=invalid')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(400)
  })

  test('interest updates require ownership, CSRF, allowlisted tags and idempotency', async () => {
    const initial = await request(app.getHttpServer())
      .get('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.deepEqual(initial.body.data, { tags: [], updatedAt: null })

    await request(app.getHttpServer())
      .put('/api/v1/discover/interests')
      .set('Idempotency-Key', randomUUID())
      .send({ tags: ['typescript'] })
      .expect(401)
    await request(app.getHttpServer())
      .put('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('Idempotency-Key', randomUUID())
      .send({ tags: ['typescript'] })
      .expect(403)
    await request(app.getHttpServer())
      .put('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ tags: ['typescript', 'not-allowed'] })
      .expect(400)

    const replayKey = randomUUID()
    const updated = await request(app.getHttpServer())
      .put('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', replayKey)
      .send({ tags: ['python', 'typescript'] })
      .expect(200)
    assert.deepEqual(updated.body.data.tags, ['typescript', 'python'])
    assert.equal(typeof updated.body.data.updatedAt, 'string')

    const replay = await request(app.getHttpServer())
      .put('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', replayKey)
      .send({ tags: ['python', 'typescript'] })
      .expect(200)
    assert.deepEqual(replay.body.data, updated.body.data)

    const unchanged = await request(app.getHttpServer())
      .put('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ tags: ['typescript', 'python'] })
      .expect(200)
    assert.deepEqual(unchanged.body.data, updated.body.data)

    const otherUser = await request(app.getHttpServer())
      .get('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(secondIdentity))
      .expect(200)
    assert.deepEqual(otherUser.body.data, { tags: [], updatedAt: null })
  })

  test('personalized ordering is deterministic and old cursors fail after interests change', async () => {
    const personalizedItems = [
      { ...items[0], tags: ['python'], engagement: { type: 'SCORE', value: 1 } },
      { ...items[1], tags: ['typescript'], engagement: { type: 'SCORE', value: 100 } },
    ]
    await databaseService.query(`
      UPDATE discover_source_cache
      SET items = $1::jsonb, refreshed_at = now()
      WHERE source = 'HACKER_NEWS'
    `, [JSON.stringify(personalizedItems)])
    await request(app.getHttpServer())
      .put('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ tags: ['typescript'] })
      .expect(200)

    const first = await request(app.getHttpServer())
      .get('/api/v1/discover?category=NEWS&limit=1')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(first.body.data.items[0].id, items[1].id)
    assert.deepEqual(first.body.data.recommendations[0], {
      itemId: items[1].id,
      reasons: ['INTEREST_MATCH', 'RECENT', 'EXTERNAL_ENGAGEMENT'],
      matchedInterests: ['typescript'],
    })
    assert.equal(typeof first.body.data.nextCursor, 'string')

    await request(app.getHttpServer())
      .put('/api/v1/discover/interests')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ tags: ['python'] })
      .expect(200)
    await request(app.getHttpServer())
      .get('/api/v1/discover')
      .query({ category: 'NEWS', limit: 1, cursor: first.body.data.nextCursor })
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(400)

    const reranked = await request(app.getHttpServer())
      .get('/api/v1/discover?category=NEWS&limit=1')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.equal(reranked.body.data.items[0].id, items[0].id)
  })
}
