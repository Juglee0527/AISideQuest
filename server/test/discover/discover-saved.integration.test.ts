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

    const discover = await request(app.getHttpServer())
      .get('/api/v1/discover')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    assert.deepEqual(discover.body.data.savedItems, [{
      itemId: items[0].id,
      savedItemId: saved.body.data.savedItem.id,
    }])
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
}
