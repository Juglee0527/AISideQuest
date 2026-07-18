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
import { seedDevelopmentQuests } from '../../src/database/seeds/development-quests'
import { QuestAttemptRecoveryService } from '../../src/quests/quest-attempt-recovery.service'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseResetAllowed = process.env.ALLOW_DATABASE_RESET === 'true'

interface Identity {
  userId: string
  sessionToken: string
  csrfToken: string
}

if (!testDatabaseUrl || !databaseResetAllowed) {
  test(
    'quest attempt integration tests require an explicitly resettable test database',
    { skip: 'Set TEST_DATABASE_URL and ALLOW_DATABASE_RESET=true' },
    () => undefined,
  )
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
  const first: Identity = {
    userId: '',
    sessionToken: 'attempt-first-session',
    csrfToken: 'attempt-first-csrf',
  }
  const second: Identity = {
    userId: '',
    sessionToken: 'attempt-second-session',
    csrfToken: 'attempt-second-csrf',
  }
  let app: INestApplication
  let database: DatabaseService
  let recovery: QuestAttemptRecoveryService

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
    recovery = app.get(QuestAttemptRecoveryService)

    const users = await database.query<Array<{ id: string }>>(`
      INSERT INTO users (display_name)
      VALUES ('Attempt first'), ('Attempt second')
      RETURNING id
    `)
    first.userId = users[0].id
    second.userId = users[1].id
    await database.query(
      `INSERT INTO user_auth_accounts (
         user_id, provider, provider_account_id, provider_login
       ) VALUES
         ($1, 'GITHUB', 'attempt-first', 'attempt-first'),
         ($2, 'GITHUB', 'attempt-second', 'attempt-second')`,
      [first.userId, second.userId],
    )
    await database.query(
      `INSERT INTO auth_sessions (user_id, token_hash, csrf_token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day'),
              ($4, $5, $6, now() + interval '1 day')`,
      [
        first.userId,
        hashToken(first.sessionToken),
        hashToken(first.csrfToken),
        second.userId,
        hashToken(second.sessionToken),
        hashToken(second.csrfToken),
      ],
    )
  })

  beforeEach(async () => {
    await database.query('DELETE FROM api_idempotency_keys')
    await database.query('DELETE FROM point_ledger')
    await database.query('DELETE FROM quest_attempts')
    await database.query('DELETE FROM ai_sessions')
    await database.query("UPDATE quests SET status = 'ARCHIVED' WHERE status = 'PUBLISHED'")
    await database.query('UPDATE quests SET retry_allowed = true')
    await database.query("UPDATE quests SET status = 'PUBLISHED' WHERE status = 'ARCHIVED'")
  })

  after(async () => app?.close())

  function cookie(identity: Identity) {
    return `aisidequest_session=${identity.sessionToken}; aisidequest_csrf=${identity.csrfToken}`
  }

  function mutation(identity: Identity, method: 'post' | 'put', path: string) {
    return request(app.getHttpServer())[method](path)
      .set('Cookie', cookie(identity))
      .set('x-csrf-token', identity.csrfToken)
  }

  async function createActiveSession(identity = first) {
    const rows = await database.query<Array<{ id: string }>>(
      `INSERT INTO ai_sessions (
         user_id, status, origin, started_at, last_activity_at
       ) VALUES ($1, 'RUNNING', 'MANUAL', now() - interval '10 minutes', now())
       RETURNING id`,
      [identity.userId],
    )
    return rows[0].id
  }

  function start(code = 'typescript-type-narrowing', key = randomUUID()) {
    return mutation(first, 'post', `/api/v1/quests/${code}/attempts`)
      .set('Idempotency-Key', key)
      .send({})
  }

  async function answerIds(code: string) {
    const rows = await database.query<Array<{
      question_id: string
      option_id: string
      is_correct: boolean
    }>>(
      `SELECT question.id AS question_id,
              option.id AS option_id,
              option.is_correct
       FROM quests quest
       JOIN quest_questions question ON question.quest_id = quest.id
       JOIN quest_options option ON option.question_id = question.id
       WHERE quest.code = $1
       ORDER BY option.position`,
      [code],
    )
    return rows
  }

  async function publishQuestVersion(code: string, version: number, prompt: string) {
    await database.transaction(async (manager) => {
      const quests = await manager.query(
        `INSERT INTO quests (
           code, version, status, title, description,
           estimated_minutes, reward_points, pass_score
         ) VALUES ($1, $2, 'DRAFT', 'Version pinning', 'Version pinning', 2, 100, 100)
         RETURNING id`,
        [code, version],
      ) as Array<{ id: string }>
      const questions = await manager.query(
        `INSERT INTO quest_questions (quest_id, position, prompt)
         VALUES ($1, 1, $2) RETURNING id`,
        [quests[0].id, prompt],
      ) as Array<{ id: string }>
      await manager.query(
        `INSERT INTO quest_options (question_id, position, label, is_correct)
         VALUES ($1, 1, 'Correct', true), ($1, 2, 'Wrong', false)`,
        [questions[0].id],
      )
      await manager.query(
        `UPDATE quests SET status = 'PUBLISHED', published_at = now()
         WHERE id = $1`,
        [quests[0].id],
      )
    })
  }

  test('starts one session-bound attempt idempotently without exposing answers', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/quests/typescript-type-narrowing/attempts')
      .expect(401)
    await request(app.getHttpServer())
      .post('/api/v1/quests/typescript-type-narrowing/attempts')
      .set('Cookie', cookie(first))
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403)
    await start().expect(409).expect(({ body }) => {
      assert.equal(body.error.code, 'ACTIVE_AI_SESSION_REQUIRED')
    })

    const aiSessionId = await createActiveSession()
    const key = randomUUID()
    const created = await start('typescript-type-narrowing', key).expect(200)
    assert.equal(created.body.data.created, true)
    assert.equal(created.body.data.attempt.aiSessionId, aiSessionId)
    assert.equal(created.body.data.attempt.questions.length, 1)
    assert.doesNotMatch(
      JSON.stringify(created.body.data),
      /isCorrect|is_correct|correctOption/i,
    )

    const replayed = await start('typescript-type-narrowing', key).expect(200)
    assert.deepEqual(replayed.body.data, created.body.data)
    const existing = await start().expect(200)
    assert.equal(existing.body.data.created, false)
    assert.equal(existing.body.data.attempt.id, created.body.data.attempt.id)

    await request(app.getHttpServer())
      .get(`/api/v1/quest-attempts/${created.body.data.attempt.id}`)
      .set('Cookie', cookie(second))
      .expect(404)

    const reusedKey = randomUUID()
    const crossQuest = await Promise.all([
      start('http-idempotency', reusedKey),
      start('git-safe-history', reusedKey),
    ])
    assert.deepEqual(
      crossQuest.map((response) => response.status).sort(),
      [200, 409],
    )
    assert.equal(
      crossQuest.find((response) => response.status === 409)?.body.error.code,
      'IDEMPOTENCY_KEY_REUSED',
    )
  })

  test('atomically replaces and restores validated answers', async () => {
    await createActiveSession()
    const created = await start().expect(200)
    const attemptId = created.body.data.attempt.id as string
    const [firstOption] = await answerIds('typescript-type-narrowing')

    await mutation(first, 'put', `/api/v1/quest-attempts/${attemptId}/answers`)
      .send({ answers: [
        { questionId: firstOption.question_id, selectedOptionId: firstOption.option_id },
        { questionId: firstOption.question_id, selectedOptionId: firstOption.option_id },
      ] })
      .expect(422)
    await mutation(first, 'put', `/api/v1/quest-attempts/${attemptId}/answers`)
      .send({ answers: [{
        questionId: firstOption.question_id,
        selectedOptionId: randomUUID(),
      }] })
      .expect(422)

    await mutation(first, 'put', `/api/v1/quest-attempts/${attemptId}/answers`)
      .send({ answers: [{
        questionId: firstOption.question_id,
        selectedOptionId: firstOption.option_id,
      }] })
      .expect(200)
    const restored = await request(app.getHttpServer())
      .get(`/api/v1/quest-attempts/${attemptId}`)
      .set('Cookie', cookie(first))
      .expect(200)
    assert.equal(
      restored.body.data.questions[0].selectedOptionId,
      firstOption.option_id,
    )
    assert.doesNotMatch(JSON.stringify(restored.body.data), /isCorrect|is_correct/i)
  })

  test('grades once under concurrent idempotent submissions and blocks a passed retry', async () => {
    await createActiveSession()
    const created = await start().expect(200)
    const attemptId = created.body.data.attempt.id as string

    await mutation(first, 'post', `/api/v1/quest-attempts/${attemptId}/submissions`)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(422)

    const correct = (await answerIds('typescript-type-narrowing'))
      .find((option) => option.is_correct)
    assert.ok(correct)
    await mutation(first, 'put', `/api/v1/quest-attempts/${attemptId}/answers`)
      .send({ answers: [{
        questionId: correct.question_id,
        selectedOptionId: correct.option_id,
      }] })
      .expect(200)

    const submissions = await Promise.all([
      mutation(first, 'post', `/api/v1/quest-attempts/${attemptId}/submissions`)
        .set('Idempotency-Key', randomUUID()).send({}),
      mutation(first, 'post', `/api/v1/quest-attempts/${attemptId}/submissions`)
        .set('Idempotency-Key', randomUUID()).send({}),
    ])
    assert.deepEqual(submissions.map((response) => response.status), [200, 200])
    assert.deepEqual(
      submissions.map((response) => response.body.data.attempt.result.score),
      [100, 100],
    )
    assert.deepEqual(
      submissions.map((response) => response.body.data.pointAward.points),
      [100, 100],
    )
    assert.equal(
      submissions[0].body.data.pointAward.ledgerEntryId,
      submissions[1].body.data.pointAward.ledgerEntryId,
    )
    const [count] = await database.query<Array<{ count: number }>>(
      `SELECT count(*)::integer AS count FROM quest_attempts
       WHERE user_id = $1 AND quest_id = $2`,
      [first.userId, created.body.data.attempt.quest.id],
    )
    assert.equal(count.count, 1)
    const [ledger] = await database.query<Array<{ count: number; points: number }>>(
      `SELECT count(*)::integer AS count, sum(points)::integer AS points
       FROM point_ledger
       WHERE user_id = $1 AND quest_id = $2`,
      [first.userId, created.body.data.attempt.quest.id],
    )
    assert.deepEqual(ledger, { count: 1, points: 100 })
    await start().expect(409).expect(({ body }) => {
      assert.equal(body.error.code, 'QUEST_ALREADY_PASSED')
    })
  })

  test('allows retry after failure only when the fixed quest policy permits it', async () => {
    await createActiveSession()
    const created = await start('http-idempotency').expect(200)
    const wrong = (await answerIds('http-idempotency')).find((option) => !option.is_correct)
    assert.ok(wrong)
    await mutation(first, 'put', `/api/v1/quest-attempts/${created.body.data.attempt.id}/answers`)
      .send({ answers: [{ questionId: wrong.question_id, selectedOptionId: wrong.option_id }] })
      .expect(200)
    const failed = await mutation(
      first,
      'post',
      `/api/v1/quest-attempts/${created.body.data.attempt.id}/submissions`,
    ).set('Idempotency-Key', randomUUID()).send({}).expect(200)
    assert.equal(failed.body.data.attempt.status, 'FAILED')
    assert.equal(failed.body.data.attempt.result.score, 0)
    assert.equal(failed.body.data.attempt.result.answerReview, null)
    assert.equal(failed.body.data.pointAward, null)
    await start('http-idempotency').expect(200)

    await database.query("UPDATE quests SET status = 'ARCHIVED' WHERE code = 'git-safe-history'")
    await database.query("UPDATE quests SET retry_allowed = false WHERE code = 'git-safe-history'")
    await database.query("UPDATE quests SET status = 'PUBLISHED' WHERE code = 'git-safe-history'")
    const noRetry = await start('git-safe-history').expect(200)
    const noRetryWrong = (await answerIds('git-safe-history')).find((option) => !option.is_correct)
    assert.ok(noRetryWrong)
    await mutation(first, 'put', `/api/v1/quest-attempts/${noRetry.body.data.attempt.id}/answers`)
      .send({ answers: [{
        questionId: noRetryWrong.question_id,
        selectedOptionId: noRetryWrong.option_id,
      }] })
      .expect(200)
    await mutation(first, 'post', `/api/v1/quest-attempts/${noRetry.body.data.attempt.id}/submissions`)
      .set('Idempotency-Key', randomUUID()).send({}).expect(200)
    await start('git-safe-history').expect(409).expect(({ body }) => {
      assert.equal(body.error.code, 'QUEST_RETRY_NOT_ALLOWED')
    })
  })

  test('returns an owned balance and cursor-paginated immutable ledger', async () => {
    await request(app.getHttpServer()).get('/api/v1/points/balance').expect(401)
    await createActiveSession()

    for (const code of ['typescript-type-narrowing', 'http-idempotency']) {
      const created = await start(code).expect(200)
      const correct = (await answerIds(code)).find((option) => option.is_correct)
      assert.ok(correct)
      await mutation(first, 'put', `/api/v1/quest-attempts/${created.body.data.attempt.id}/answers`)
        .send({ answers: [{
          questionId: correct.question_id,
          selectedOptionId: correct.option_id,
        }] })
        .expect(200)
      await mutation(first, 'post', `/api/v1/quest-attempts/${created.body.data.attempt.id}/submissions`)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(200)
    }

    const balance = await request(app.getHttpServer())
      .get('/api/v1/points/balance')
      .set('Cookie', cookie(first))
      .expect(200)
    assert.equal(balance.body.data.balance, 200)
    const otherBalance = await request(app.getHttpServer())
      .get('/api/v1/points/balance')
      .set('Cookie', cookie(second))
      .expect(200)
    assert.equal(otherBalance.body.data.balance, 0)

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/points/ledger?limit=1')
      .set('Cookie', cookie(first))
      .expect(200)
    assert.equal(firstPage.body.data.items.length, 1)
    assert.equal(firstPage.body.data.items[0].points, 100)
    assert.equal(firstPage.body.data.items[0].entryType, 'QUEST_REWARD')
    assert.ok(firstPage.body.data.nextCursor)
    assert.doesNotMatch(JSON.stringify(firstPage.body.data), /userId|isCorrect|selectedOption/i)

    const secondPage = await request(app.getHttpServer())
      .get(`/api/v1/points/ledger?limit=1&cursor=${encodeURIComponent(firstPage.body.data.nextCursor)}`)
      .set('Cookie', cookie(first))
      .expect(200)
    assert.equal(secondPage.body.data.items.length, 1)
    assert.equal(secondPage.body.data.nextCursor, null)
    assert.notEqual(secondPage.body.data.items[0].id, firstPage.body.data.items[0].id)

    await request(app.getHttpServer())
      .get('/api/v1/points/ledger?cursor=not-a-valid-cursor')
      .set('Cookie', cookie(first))
      .expect(400)
    await request(app.getHttpServer())
      .get('/api/v1/points/ledger')
      .set('Cookie', cookie(second))
      .expect(200)
      .expect(({ body }) => assert.deepEqual(body.data.items, []))
  })

  test('rolls grading back when the point ledger insert fails', async () => {
    await createActiveSession()
    const created = await start('typescript-type-narrowing').expect(200)
    const attemptId = created.body.data.attempt.id as string
    const correct = (await answerIds('typescript-type-narrowing'))
      .find((option) => option.is_correct)
    assert.ok(correct)
    await mutation(first, 'put', `/api/v1/quest-attempts/${attemptId}/answers`)
      .send({ answers: [{
        questionId: correct.question_id,
        selectedOptionId: correct.option_id,
      }] })
      .expect(200)

    await database.query(`
      CREATE FUNCTION test_fail_point_ledger_insert() RETURNS trigger AS $trigger$
      BEGIN
        RAISE EXCEPTION 'forced point ledger failure';
      END;
      $trigger$ LANGUAGE plpgsql
    `)
    await database.query(`
      CREATE TRIGGER test_fail_point_ledger_insert
      BEFORE INSERT ON point_ledger
      FOR EACH ROW EXECUTE FUNCTION test_fail_point_ledger_insert()
    `)
    try {
      await mutation(first, 'post', `/api/v1/quest-attempts/${attemptId}/submissions`)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(500)
    } finally {
      await database.query('DROP TRIGGER test_fail_point_ledger_insert ON point_ledger')
      await database.query('DROP FUNCTION test_fail_point_ledger_insert()')
    }

    const [state] = await database.query<Array<{
      status: string
      score: number | null
      passed: boolean | null
      graded_answers: number
      ledger_entries: number
    }>>(
      `SELECT attempt.status,
              attempt.score,
              attempt.passed,
              count(answer.is_correct)::integer AS graded_answers,
              (SELECT count(*)::integer FROM point_ledger ledger
               WHERE ledger.quest_attempt_id = attempt.id) AS ledger_entries
       FROM quest_attempts attempt
       LEFT JOIN quest_attempt_answers answer ON answer.attempt_id = attempt.id
       WHERE attempt.id = $1
       GROUP BY attempt.id`,
      [attemptId],
    )
    assert.deepEqual(state, {
      status: 'IN_PROGRESS',
      score: null,
      passed: null,
      graded_answers: 0,
      ledger_entries: 0,
    })
  })

  test('accepts the terminal-session grace period and expires overdue attempts', async () => {
    const firstSession = await createActiveSession()
    const within = await start('postgresql-unique-constraint').expect(200)
    const correct = (await answerIds('postgresql-unique-constraint'))
      .find((option) => option.is_correct)
    assert.ok(correct)
    await mutation(first, 'put', `/api/v1/quest-attempts/${within.body.data.attempt.id}/answers`)
      .send({ answers: [{ questionId: correct.question_id, selectedOptionId: correct.option_id }] })
      .expect(200)
    await database.query(
      `UPDATE ai_sessions
       SET status = 'COMPLETED', ended_at = now() - interval '4 minutes 59 seconds',
           terminal_reason = 'MANUAL_COMPLETED', version = version + 1
       WHERE id = $1`,
      [firstSession],
    )
    await mutation(first, 'post', `/api/v1/quest-attempts/${within.body.data.attempt.id}/submissions`)
      .set('Idempotency-Key', randomUUID()).send({}).expect(200)

    const secondSession = await createActiveSession()
    const overdue = await start('testing-boundary-values').expect(200)
    await database.query(
      `UPDATE quest_attempts SET started_at = now() - interval '10 minutes'
       WHERE id = $1`,
      [overdue.body.data.attempt.id],
    )
    await database.query(
      `UPDATE ai_sessions
       SET status = 'COMPLETED', ended_at = now() - interval '5 minutes 1 second',
           terminal_reason = 'MANUAL_COMPLETED', version = version + 1
       WHERE id = $1`,
      [secondSession],
    )
    const cleanup = await recovery.runCleanup()
    assert.equal(cleanup.attemptsExpired, 1)
    const expired = await request(app.getHttpServer())
      .get(`/api/v1/quest-attempts/${overdue.body.data.attempt.id}`)
      .set('Cookie', cookie(first))
      .expect(200)
    assert.equal(expired.body.data.status, 'EXPIRED')
    assert.equal(expired.body.data.result, null)
    const [expiredLedger] = await database.query<Array<{ count: number }>>(
      `SELECT count(*)::integer AS count
       FROM point_ledger
       WHERE quest_attempt_id = $1`,
      [overdue.body.data.attempt.id],
    )
    assert.equal(expiredLedger.count, 0)

    await createActiveSession()
    const retry = await start('testing-boundary-values').expect(200)
    assert.notEqual(retry.body.data.attempt.id, overdue.body.data.attempt.id)
  })

  test('keeps an attempt pinned to its starting version after a new version is published', async () => {
    const code = 'version-pinning'
    await publishQuestVersion(code, 1, 'Version one question')
    await createActiveSession()
    const created = await start(code).expect(200)
    assert.equal(created.body.data.attempt.quest.version, 1)

    await database.query(
      "UPDATE quests SET status = 'ARCHIVED' WHERE code = $1 AND version = 1",
      [code],
    )
    await publishQuestVersion(code, 2, 'Version two question')

    const restored = await request(app.getHttpServer())
      .get(`/api/v1/quest-attempts/${created.body.data.attempt.id}`)
      .set('Cookie', cookie(first))
      .expect(200)
    assert.equal(restored.body.data.quest.version, 1)
    assert.equal(restored.body.data.questions[0].prompt, 'Version one question')
  })
}
