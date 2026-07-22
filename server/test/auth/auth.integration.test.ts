import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import request, { type Response as SupertestResponse } from 'supertest'
import { DataSource } from 'typeorm'

import { AppModule } from '../../src/app.module'
import { configureApplication } from '../../src/bootstrap/configure-application'
import { validateEnvironment } from '../../src/config/environment'
import { createDataSourceOptions } from '../../src/database/data-source'
import { DatabaseService } from '../../src/database/database.service'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseResetAllowed = process.env.ALLOW_DATABASE_RESET === 'true'

function getSetCookie(response: SupertestResponse, cookieName: string) {
  const setCookies = response.headers['set-cookie']

  assert.ok(Array.isArray(setCookies), 'Expected Set-Cookie headers')
  const cookie = setCookies.find((value) => value.startsWith(`${cookieName}=`))

  assert.ok(cookie, `Expected ${cookieName} cookie`)
  return cookie
}

function getCookiePair(setCookie: string) {
  const [cookiePair] = setCookie.split(';')
  assert.ok(cookiePair)
  return cookiePair
}

if (!testDatabaseUrl || !databaseResetAllowed) {
  test(
    'auth integration tests require an explicitly resettable test database',
    { skip: 'Set TEST_DATABASE_URL and ALLOW_DATABASE_RESET=true' },
    () => undefined,
  )
} else {
  const parsedDatabaseUrl = new URL(testDatabaseUrl)
  const databaseName = parsedDatabaseUrl.pathname.slice(1)
  const originalFetch = globalThis.fetch
  const originalEnvironment = new Map<string, string | undefined>()
  let app: INestApplication
  let databaseService: DatabaseService
  let callbackCodeVerifier: string | undefined

  const environment = {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl,
    DATABASE_SSL: 'false',
    GITHUB_CLIENT_ID: 'test-github-client',
    GITHUB_CLIENT_SECRET: 'test-github-secret',
    GITHUB_CALLBACK_URL:
      'http://localhost:3000/api/v1/auth/github/callback',
    AUTH_SUCCESS_REDIRECT_URL: 'http://localhost:5173/',
    AUTH_FAILURE_REDIRECT_URL:
      'http://localhost:5173/?authError=github_oauth_failed',
    AUTH_SESSION_TTL_HOURS: '168',
  }

  before(async () => {
    assert.match(
      databaseName,
      /test/i,
      'TEST_DATABASE_URL database name must contain "test"',
    )

    for (const [name, value] of Object.entries(environment)) {
      originalEnvironment.set(name, process.env[name])
      process.env[name] = value
    }

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

    globalThis.fetch = (async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === 'https://github.com/login/oauth/access_token') {
        const body = new URLSearchParams(String(init?.body))
        callbackCodeVerifier = body.get('code_verifier') ?? undefined

        assert.equal(body.get('client_id'), 'test-github-client')
        assert.equal(body.get('client_secret'), 'test-github-secret')
        assert.equal(body.get('code'), 'temporary-github-code')
        assert.equal(
          body.get('redirect_uri'),
          'http://localhost:3000/api/v1/auth/github/callback',
        )

        return new Response(
          JSON.stringify({
            access_token: 'temporary-access-token',
            token_type: 'bearer',
            scope: '',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (url === 'https://api.github.com/user') {
        const headers = new Headers(init?.headers)
        assert.equal(
          headers.get('Authorization'),
          'Bearer temporary-access-token',
        )
        assert.equal(headers.get('X-GitHub-Api-Version'), '2026-03-10')

        return new Response(
          JSON.stringify({
            id: 123456,
            login: 'octocat',
            name: 'Octo Cat',
            avatar_url: 'https://avatars.githubusercontent.com/u/123456',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

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
  })

  after(async () => {
    await app?.close()
    globalThis.fetch = originalFetch

    for (const [name, value] of originalEnvironment) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  })

  test('protected current-user API rejects requests without a session', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401)

    assert.equal(response.body.error.code, 'AUTH_REQUIRED')
  })

  test('GitHub OAuth uses state and PKCE, then creates hash-only cookies', async () => {
    const agent = request.agent(app.getHttpServer())
    const returnPath = '/devices/connect/123e4567-e89b-42d3-a456-426614174000'
    const startResponse = await agent
      .get('/api/v1/auth/github')
      .query({ returnTo: returnPath })
      .expect(302)
    const authorizationUrl = new URL(startResponse.headers.location)
    const state = authorizationUrl.searchParams.get('state')
    const codeChallenge = authorizationUrl.searchParams.get('code_challenge')
    const stateSetCookie = getSetCookie(
      startResponse,
      'aisidequest_oauth_state',
    )
    const stateCookie = getCookiePair(stateSetCookie)

    assert.equal(authorizationUrl.origin, 'https://github.com')
    assert.equal(authorizationUrl.pathname, '/login/oauth/authorize')
    assert.equal(
      authorizationUrl.searchParams.get('client_id'),
      'test-github-client',
    )
    assert.equal(
      authorizationUrl.searchParams.get('redirect_uri'),
      'http://localhost:3000/api/v1/auth/github/callback',
    )
    assert.match(state ?? '', /^[A-Za-z0-9_-]{43}$/)
    assert.match(codeChallenge ?? '', /^[A-Za-z0-9_-]{43}$/)
    assert.equal(
      authorizationUrl.searchParams.get('code_challenge_method'),
      'S256',
    )
    assert.match(stateSetCookie, /HttpOnly/i)
    assert.match(stateSetCookie, /SameSite=Lax/i)

    const callbackResponse = await agent
      .get('/api/v1/auth/github/callback')
      .query({ code: 'temporary-github-code', state })
      .expect(302)

    assert.equal(
      callbackResponse.headers.location,
      `http://localhost:5173${returnPath}`,
    )
    assert.match(callbackCodeVerifier ?? '', /^[A-Za-z0-9_-]{43}$/)

    const sessionSetCookie = getSetCookie(
      callbackResponse,
      'aisidequest_session',
    )
    const csrfSetCookie = getSetCookie(
      callbackResponse,
      'aisidequest_csrf',
    )
    const sessionCookie = getCookiePair(sessionSetCookie)
    const csrfCookie = getCookiePair(csrfSetCookie)
    const csrfToken = csrfCookie.slice(csrfCookie.indexOf('=') + 1)

    assert.match(sessionSetCookie, /HttpOnly/i)
    assert.match(sessionSetCookie, /SameSite=Lax/i)
    assert.doesNotMatch(csrfSetCookie, /HttpOnly/i)
    assert.match(csrfSetCookie, /SameSite=Lax/i)

    const currentUserResponse = await agent
      .get('/api/v1/auth/me')
      .expect(200)

    assert.deepEqual(currentUserResponse.body.data, {
      id: currentUserResponse.body.data.id,
      displayName: 'Octo Cat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/123456',
      githubLogin: 'octocat',
      timeZone: 'UTC',
      timeZoneVerified: false,
    })

    await agent.patch('/api/v1/auth/me/time-zone').send({ timeZone: 'Asia/Seoul' }).expect(403)
    await agent
      .patch('/api/v1/auth/me/time-zone')
      .set('x-csrf-token', csrfToken)
      .send({ timeZone: 'Invalid/Nowhere' })
      .expect(400)
      .expect(({ body }) => assert.equal(body.error.code, 'INVALID_TIME_ZONE'))
    await agent
      .patch('/api/v1/auth/me/time-zone')
      .set('x-csrf-token', csrfToken)
      .send({ timeZone: 'Asia/Seoul' })
      .expect(200)
      .expect(({ body }) => assert.deepEqual(body.data, {
        timeZone: 'Asia/Seoul',
        timeZoneVerified: true,
      }))
    await agent.get('/api/v1/auth/me').expect(200).expect(({ body }) => {
      assert.equal(body.data.timeZone, 'Asia/Seoul')
      assert.equal(body.data.timeZoneVerified, true)
    })

    const [storedSession] = await databaseService.query<
      Array<{ token_hash: string; csrf_token_hash: string }>
    >('SELECT token_hash, csrf_token_hash FROM auth_sessions')
    const rawSessionToken = sessionCookie.slice(sessionCookie.indexOf('=') + 1)

    assert.match(storedSession.token_hash, /^[0-9a-f]{64}$/)
    assert.match(storedSession.csrf_token_hash, /^[0-9a-f]{64}$/)
    assert.notEqual(storedSession.token_hash, rawSessionToken)
    assert.notEqual(storedSession.csrf_token_hash, csrfToken)

    const reusedStateResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/github/callback')
      .set('Cookie', stateCookie)
      .query({ code: 'temporary-github-code', state })
      .expect(401)

    assert.equal(reusedStateResponse.body.error.code, 'OAUTH_STATE_INVALID')

    const csrfFailure = await agent.post('/api/v1/auth/logout').expect(403)
    assert.equal(csrfFailure.body.error.code, 'CSRF_TOKEN_INVALID')

    await agent
      .post('/api/v1/auth/logout')
      .set('x-csrf-token', csrfToken)
      .expect(204)

    await agent.get('/api/v1/auth/me').expect(401)

    const [revokedSession] = await databaseService.query<
      Array<{ revoked_at: Date | null }>
    >('SELECT revoked_at FROM auth_sessions')
    assert.ok(revokedSession.revoked_at instanceof Date)
  })

  test('re-login reuses the GitHub user and expired sessions are rejected', async () => {
    const agent = request.agent(app.getHttpServer())
    const startResponse = await agent.get('/api/v1/auth/github').expect(302)
    const authorizationUrl = new URL(startResponse.headers.location)
    const state = authorizationUrl.searchParams.get('state')

    await agent
      .get('/api/v1/auth/github/callback')
      .query({ code: 'temporary-github-code', state })
      .expect(302)

    const [counts] = await databaseService.query<
      Array<{ users: number; auth_accounts: number; sessions: number }>
    >(`
      SELECT
        (SELECT count(*)::integer FROM users) AS users,
        (SELECT count(*)::integer FROM user_auth_accounts) AS auth_accounts,
        (SELECT count(*)::integer FROM auth_sessions) AS sessions
    `)

    assert.deepEqual(counts, {
      users: 1,
      auth_accounts: 1,
      sessions: 2,
    })

    await databaseService.query(`
      UPDATE auth_sessions
      SET created_at = now() - interval '8 days',
          last_seen_at = now() - interval '8 days',
          expires_at = now() - interval '1 second'
      WHERE revoked_at IS NULL
    `)

    const expiredResponse = await agent.get('/api/v1/auth/me').expect(401)
    assert.equal(expiredResponse.body.error.code, 'AUTH_SESSION_INVALID')
    assert.match(
      getSetCookie(expiredResponse, 'aisidequest_session'),
      /Expires=Thu, 01 Jan 1970/i,
    )
  })

  test('GitHub authorization denial redirects to the configured failure URL', async () => {
    const agent = request.agent(app.getHttpServer())
    const startResponse = await agent.get('/api/v1/auth/github').expect(302)
    const state = new URL(startResponse.headers.location).searchParams.get(
      'state',
    )

    const response = await agent
      .get('/api/v1/auth/github/callback')
      .query({
        error: 'access_denied',
        error_description: 'The user denied access',
        error_uri: 'https://docs.github.com/apps/oauth-apps',
        state,
      })
      .expect(302)

    assert.equal(
      response.headers.location,
      'http://localhost:5173/?authError=github_oauth_failed',
    )
  })

  test('OAuth return path rejects external redirects', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/github')
      .query({ returnTo: '//evil.example/steal' })
      .expect(400)
  })

  test('user export excludes secrets and account deletion removes owned server data', async () => {
    const agent = request.agent(app.getHttpServer())
    const startResponse = await agent.get('/api/v1/auth/github').expect(302)
    const state = new URL(startResponse.headers.location).searchParams.get('state')
    const callbackResponse = await agent
      .get('/api/v1/auth/github/callback')
      .query({ code: 'temporary-github-code', state })
      .expect(302)
    const csrfCookie = getCookiePair(getSetCookie(callbackResponse, 'aisidequest_csrf'))
    const csrfToken = csrfCookie.slice(csrfCookie.indexOf('=') + 1)
    const currentUser = await agent.get('/api/v1/auth/me').expect(200)
    const userId = currentUser.body.data.id as string
    const savedDiscoverItem = {
      id: 'HACKER_NEWS:export-1',
      source: 'HACKER_NEWS',
      category: 'NEWS',
      kind: 'ARTICLE',
      title: 'Exported saved item',
      summary: null,
      tags: ['typescript'],
      reward: null,
      compensation: null,
      engagement: null,
      readingTimeMinutes: null,
      originalUrl: 'https://news.ycombinator.com/item?id=export-1',
      attribution: 'Hacker News',
      publishedAt: '2026-07-21T00:00:00.000Z',
      fetchedAt: '2026-07-21T00:00:00.000Z',
    }
    await databaseService.query(`
      INSERT INTO discover_saved_items (user_id, source, source_item_id, item)
      VALUES ($1, 'HACKER_NEWS', $2, $3::jsonb)
    `, [userId, savedDiscoverItem.id, JSON.stringify(savedDiscoverItem)])
    await databaseService.query(`
      INSERT INTO discover_user_interests (user_id, tags)
      VALUES ($1, ARRAY['typescript', 'react']::text[])
    `, [userId])
    await databaseService.query(`
      INSERT INTO discover_analytics_events (user_id, event_name, category)
      VALUES ($1, 'TAB_VIEW', 'NEWS')
    `, [userId])

    await agent.post('/api/v1/auth/me/export').send({}).expect(403)
    const exportResponse = await agent
      .post('/api/v1/auth/me/export')
      .set('x-csrf-token', csrfToken)
      .send({})
      .expect(200)
    const exported = JSON.stringify(exportResponse.body.data)

    assert.equal(exportResponse.body.data.schemaVersion, 4)
    assert.equal(exportResponse.body.data.profile.id, userId)
    assert.equal(exportResponse.body.data.discoverSavedItems.length, 1)
    assert.equal(exportResponse.body.data.discoverSavedItems[0].item.id, savedDiscoverItem.id)
    assert.deepEqual(exportResponse.body.data.discoverInterests.tags, ['typescript', 'react'])
    assert.deepEqual(exportResponse.body.data.discoverAnalyticsEvents.map((event: Record<string, unknown>) => ({
      eventName: event.eventName,
      source: event.source,
      category: event.category,
    })), [{ eventName: 'TAB_VIEW', source: null, category: 'NEWS' }])
    assert.equal('userId' in exportResponse.body.data.discoverAnalyticsEvents[0], false)
    assert.doesNotMatch(exported, /tokenHash|csrfToken|requestHash|responseBody|externalSessionKey|externalTurnKey/i)

    await databaseService.query(`
      UPDATE auth_sessions
      SET created_at = now() - interval '16 minutes'
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
    `, [userId])
    await agent
      .post('/api/v1/auth/me/export')
      .set('x-csrf-token', csrfToken)
      .send({})
      .expect(403)
      .expect(({ body }) => assert.equal(body.error.code, 'RECENT_AUTHENTICATION_REQUIRED'))
    await databaseService.query(`
      UPDATE auth_sessions SET created_at = now() - interval '1 minute'
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
    `, [userId])

    const [otherUser] = await databaseService.query<Array<{ id: string }>>(`
      INSERT INTO users (display_name) VALUES ('Preserved user') RETURNING id
    `)
    const deleted = await agent
      .delete('/api/v1/auth/me')
      .set('x-csrf-token', csrfToken)
      .send({ confirmation: 'DELETE' })
      .expect(200)

    assert.equal(deleted.body.data.deleted, true)
    assert.match(deleted.body.data.localPluginAction, /플러그인/)
    assert.match(getSetCookie(deleted, 'aisidequest_session'), /Expires=Thu, 01 Jan 1970/i)
    await agent.get('/api/v1/auth/me').expect(401)

    const [counts] = await databaseService.query<Array<{
      deleted_user: number
      other_user: number
      saved_items: number
      interests: number
      analytics: number
    }>>(`
      SELECT
        (SELECT count(*)::integer FROM users WHERE id = $1) AS deleted_user,
        (SELECT count(*)::integer FROM users WHERE id = $2) AS other_user,
        (SELECT count(*)::integer FROM discover_saved_items WHERE user_id = $1) AS saved_items,
        (SELECT count(*)::integer FROM discover_user_interests WHERE user_id = $1) AS interests
        ,(SELECT count(*)::integer FROM discover_analytics_events WHERE user_id = $1) AS analytics
    `, [userId, otherUser.id])
    assert.deepEqual(counts, {
      deleted_user: 0,
      other_user: 1,
      saved_items: 0,
      interests: 0,
      analytics: 0,
    })
  })

  test('OAuth start rate limit is shared in PostgreSQL and returns Retry-After', async () => {
    await databaseService.query("DELETE FROM rate_limit_buckets WHERE scope = 'OAUTH_START'")

    for (let index = 0; index < 10; index += 1) {
      await request(app.getHttpServer()).get('/api/v1/auth/github').expect(302)
    }

    const limited = await request(app.getHttpServer())
      .get('/api/v1/auth/github')
      .expect(429)

    assert.equal(limited.body.error.code, 'RATE_LIMITED')
    assert.equal(limited.headers['retry-after'], '600')
  })
}
