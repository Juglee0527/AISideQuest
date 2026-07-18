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

function hasPostgresCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

if (!testDatabaseUrl || !databaseResetAllowed) {
  test(
    'quest integration tests require an explicitly resettable test database',
    { skip: 'Set TEST_DATABASE_URL and ALLOW_DATABASE_RESET=true' },
    () => undefined,
  )
} else {
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1)
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
  const sessionToken = 'quest-user-session-token'
  const otherSessionToken = 'other-quest-user-session-token'
  let app: INestApplication
  let databaseService: DatabaseService
  let userId: string
  let otherUserId: string

  before(async () => {
    assert.match(databaseName, /test/i)
    const setupDataSource = new DataSource(createDataSourceOptions({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_SSL: false,
    }))
    await setupDataSource.initialize()
    await setupDataSource.dropDatabase()
    await setupDataSource.runMigrations()
    await seedDevelopmentQuests(setupDataSource)
    await setupDataSource.destroy()

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
      VALUES ('Quest user'), ('Other quest user')
      RETURNING id
    `)
    userId = users[0].id
    otherUserId = users[1].id
    await databaseService.query(
      `INSERT INTO user_auth_accounts (
         user_id, provider, provider_account_id, provider_login
       ) VALUES
         ($1, 'GITHUB', 'quest-user', 'quest-user'),
         ($2, 'GITHUB', 'other-quest-user', 'other-quest-user')`,
      [userId, otherUserId],
    )
    await databaseService.query(
      `INSERT INTO auth_sessions (user_id, token_hash, csrf_token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day'),
              ($4, $5, $6, now() + interval '1 day')`,
      [
        userId,
        hashToken(sessionToken),
        hashToken('quest-csrf'),
        otherUserId,
        hashToken(otherSessionToken),
        hashToken('other-quest-csrf'),
      ],
    )
  })

  beforeEach(async () => {
    await databaseService.query('DELETE FROM point_ledger')
    await databaseService.query('DELETE FROM quest_attempts')
  })

  after(async () => app?.close())

  function authenticated(path: string, token = sessionToken) {
    return request(app.getHttpServer())
      .get(path)
      .set('Cookie', `aisidequest_session=${token}`)
  }

  test('lists only published quest metadata with stable cursor pagination', async () => {
    await request(app.getHttpServer()).get('/api/v1/quests').expect(401)
    const first = await authenticated('/api/v1/quests?limit=2').expect(200)
    assert.equal(first.body.data.items.length, 2)
    assert.equal(typeof first.body.data.nextCursor, 'string')
    const second = await authenticated(
      `/api/v1/quests?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
    ).expect(200)
    const third = await authenticated(
      `/api/v1/quests?limit=2&cursor=${encodeURIComponent(second.body.data.nextCursor)}`,
    ).expect(200)
    const items = [
      ...first.body.data.items,
      ...second.body.data.items,
      ...third.body.data.items,
    ]

    assert.equal(items.length, 5)
    assert.equal(new Set(items.map((item: { id: string }) => item.id)).size, 5)
    assert.deepEqual(Object.keys(items[0]).sort(), [
      'code',
      'completionStatus',
      'description',
      'estimatedMinutes',
      'id',
      'latestAttempt',
      'passScore',
      'retryAllowed',
      'rewardPoints',
      'title',
      'version',
    ])
    assert.doesNotMatch(
      JSON.stringify(items),
      /isCorrect|is_correct|correctOption|question|options|DRAFT|ARCHIVED/i,
    )

    await authenticated('/api/v1/quests?limit=0').expect(400)
    await authenticated('/api/v1/quests?cursor=invalid').expect(400)
  })

  test('returns published detail and hides draft, archived and unknown codes', async () => {
    const detail = await authenticated('/api/v1/quests/typescript-type-narrowing').expect(200)
    assert.equal(detail.body.data.code, 'typescript-type-narrowing')
    assert.equal(detail.body.data.rewardPoints, 100)
    assert.equal(detail.body.data.latestAttempt, null)
    assert.doesNotMatch(JSON.stringify(detail.body.data), /question|option|correct/i)

    await databaseService.query(`
      INSERT INTO quests (
        code, version, status, title, description,
        estimated_minutes, reward_points, pass_score
      ) VALUES ('draft-quest', 1, 'DRAFT', 'Draft', 'Draft quest', 2, 100, 100)
    `)
    await databaseService.query(`
      INSERT INTO quests (
        code, version, status, title, description,
        estimated_minutes, reward_points, pass_score, published_at
      ) VALUES ('archived-quest', 1, 'ARCHIVED', 'Archived', 'Archived quest', 2, 100, 100, now())
    `)

    await authenticated('/api/v1/quests/draft-quest').expect(404)
    await authenticated('/api/v1/quests/archived-quest').expect(404)
    await authenticated('/api/v1/quests/not-found').expect(404)
    await authenticated('/api/v1/quests/INVALID').expect(404)
  })

  test('returns only the current user latest attempt and completion state', async () => {
    const quests = await databaseService.query<Array<{ id: string; code: string }>>(
      `SELECT id, code FROM quests
       WHERE code IN ('typescript-type-narrowing', 'http-idempotency')`,
    )
    const byCode = new Map(quests.map((quest) => [quest.code, quest.id]))
    await databaseService.query(
      `INSERT INTO quest_attempts (
         user_id, quest_id, status, submitted_at, completed_at,
         score, passed, reward_points_snapshot, started_at
       ) VALUES
         ($1, $2, 'COMPLETED', now(), now(), 100, true, 100, now() - interval '2 minutes'),
         ($1, $3, 'IN_PROGRESS', NULL, NULL, NULL, NULL, NULL, now()),
         ($4, $2, 'FAILED', now(), now(), 0, false, 100, now() - interval '1 minute')`,
      [
        userId,
        byCode.get('typescript-type-narrowing'),
        byCode.get('http-idempotency'),
        otherUserId,
      ],
    )
    await databaseService.query(
      `UPDATE quests SET status = 'ARCHIVED'
       WHERE code = 'http-idempotency'`,
    )
    await databaseService.query(
      `UPDATE quests SET retry_allowed = false
       WHERE code = 'http-idempotency'`,
    )
    await databaseService.query(
      `UPDATE quests SET status = 'PUBLISHED'
       WHERE code = 'http-idempotency'`,
    )

    const passed = await authenticated('/api/v1/quests/typescript-type-narrowing').expect(200)
    assert.equal(passed.body.data.completionStatus, 'PASSED')
    assert.equal(passed.body.data.latestAttempt.passed, true)
    const inProgress = await authenticated('/api/v1/quests/http-idempotency').expect(200)
    assert.equal(inProgress.body.data.completionStatus, 'IN_PROGRESS')
    assert.equal(inProgress.body.data.retryAllowed, false)
  })

  test('database rejects publishing incomplete content and invalidating published content', async () => {
    await assert.rejects(
      databaseService.query(`
        INSERT INTO quests (
          code, version, status, title, description,
          estimated_minutes, reward_points, pass_score, published_at
        ) VALUES (
          'invalid-published', 1, 'PUBLISHED', 'Invalid', 'No questions',
          2, 100, 100, now()
        )
      `),
      (error: unknown) => hasPostgresCode(error, '23514'),
    )

    const [correct] = await databaseService.query<Array<{ id: string }>>(`
      SELECT option.id
      FROM quest_options option
      JOIN quest_questions question ON question.id = option.question_id
      JOIN quests quest ON quest.id = question.quest_id
      WHERE quest.code = 'typescript-type-narrowing' AND option.is_correct = true
    `)
    await assert.rejects(
      databaseService.query('DELETE FROM quest_options WHERE id = $1', [correct.id]),
      (error: unknown) => hasPostgresCode(error, '23514'),
    )
  })
}
