import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

import { DataSource } from 'typeorm'

import { createDataSourceOptions } from '../../src/database/data-source'
import { seedDevelopmentQuests } from '../../src/database/seeds/development-quests'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseResetAllowed = process.env.ALLOW_DATABASE_RESET === 'true'

function hasPostgresCode(error: unknown, expectedCode: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === expectedCode
  )
}

if (!testDatabaseUrl || !databaseResetAllowed) {
  test(
    'database integration tests require an explicitly resettable test database',
    { skip: 'Set TEST_DATABASE_URL and ALLOW_DATABASE_RESET=true' },
    () => undefined,
  )
} else {
  const parsedDatabaseUrl = new URL(testDatabaseUrl)
  const databaseName = parsedDatabaseUrl.pathname.slice(1)
  let dataSource: DataSource
  let testUserId: string

  before(async () => {
    assert.match(
      databaseName,
      /test/i,
      'TEST_DATABASE_URL database name must contain "test"',
    )

    dataSource = new DataSource(
      createDataSourceOptions({
        DATABASE_URL: testDatabaseUrl,
        DATABASE_SSL: false,
      }),
    )

    await dataSource.initialize()
    await dataSource.dropDatabase()
    await dataSource.runMigrations()
  })

  after(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy()
    }
  })

  test('migration creates the full schema and can be reapplied after revert', async () => {
    const expectedTables = [
      'ai_sessions',
      'devices',
      'integration_events',
      'point_ledger',
      'quest_attempt_answers',
      'quest_attempts',
      'quest_options',
      'quest_questions',
      'quests',
      'user_auth_accounts',
      'users',
    ]
    const rows = (await dataSource.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name <> 'schema_migrations'
        ORDER BY table_name
      `,
    )) as Array<{ table_name: string }>

    assert.deepEqual(
      rows.map((row) => row.table_name),
      expectedTables,
    )
    assert.deepEqual(await dataSource.runMigrations(), [])

    await dataSource.undoLastMigration()
    const [revertedTable] = (await dataSource.query(
      "SELECT to_regclass('public.users') AS users_table",
    )) as Array<{ users_table: string | null }>
    assert.equal(revertedTable.users_table, null)

    const reappliedMigrations = await dataSource.runMigrations()
    assert.equal(reappliedMigrations.length, 1)
  })

  test('development seed is idempotent and creates five complete quizzes', async () => {
    await seedDevelopmentQuests(dataSource)
    await seedDevelopmentQuests(dataSource)

    const [counts] = (await dataSource.query(`
      SELECT
        (SELECT count(*)::integer FROM quests) AS quests,
        (SELECT count(*)::integer FROM quest_questions) AS questions,
        (SELECT count(*)::integer FROM quest_options) AS options,
        (
          SELECT count(*)::integer
          FROM quest_options
          WHERE is_correct = true
        ) AS correct_options
    `)) as Array<{
      quests: number
      questions: number
      options: number
      correct_options: number
    }>

    assert.deepEqual(counts, {
      quests: 5,
      questions: 5,
      options: 20,
      correct_options: 5,
    })
  })

  test('database allows only one active session per user', async () => {
    const [user] = (await dataSource.query(
      `
        INSERT INTO users (display_name)
        VALUES ('DB integration user')
        RETURNING id
      `,
    )) as Array<{ id: string }>

    assert.ok(user)
    testUserId = user.id

    await dataSource.query(
      `
        INSERT INTO ai_sessions (user_id, status, origin)
        VALUES ($1, 'RUNNING', 'MANUAL')
      `,
      [testUserId],
    )

    await assert.rejects(
      dataSource.query(
        `
          INSERT INTO ai_sessions (user_id, status, origin)
          VALUES ($1, 'WAITING_FOR_USER', 'HOOK')
        `,
        [testUserId],
      ),
      (error: unknown) => hasPostgresCode(error, '23505'),
    )

    await assert.rejects(
      dataSource.query(
        `
          INSERT INTO ai_sessions (
            user_id, status, origin, ended_at, terminal_reason
          )
          VALUES ($1, 'FAILED', 'MANUAL', now(), 'HOOK_STOP')
        `,
        [testUserId],
      ),
      (error: unknown) => hasPostgresCode(error, '23514'),
    )
  })

  test('integration event uniqueness and device ownership are DB-enforced', async () => {
    const [device] = (await dataSource.query(
      `
        INSERT INTO devices (
          user_id, name, token_hash, expires_at
        )
        VALUES ($1, 'Test Codex plugin', $2, now() + interval '1 day')
        RETURNING id
      `,
      [testUserId, 'a'.repeat(64)],
    )) as Array<{ id: string }>
    const eventId = randomUUID()
    const eventParameters = [
      eventId,
      device.id,
      testUserId,
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64),
    ]

    const insertEvent = () =>
      dataSource.query(
        `
          INSERT INTO integration_events (
            event_id, device_id, user_id, event,
            external_session_key, external_turn_key,
            observed_at, processing_result, request_hash
          )
          VALUES (
            $1, $2, $3, 'UserPromptSubmit', $4, $5,
            now(), 'APPLIED', $6
          )
        `,
        eventParameters,
      )

    await insertEvent()
    await assert.rejects(insertEvent(), (error: unknown) =>
      hasPostgresCode(error, '23505'),
    )

    await assert.rejects(
      dataSource.query(
        `
          INSERT INTO integration_events (
            event_id, device_id, user_id, event,
            external_session_key, external_turn_key,
            observed_at, processing_result, request_hash
          )
          VALUES (
            $1, $2, $3, 'Stop', $4, $5, now(), 'APPLIED', $6
          )
        `,
        [
          randomUUID(),
          randomUUID(),
          testUserId,
          'e'.repeat(64),
          'f'.repeat(64),
          '0'.repeat(64),
        ],
      ),
      (error: unknown) => hasPostgresCode(error, '23503'),
    )
  })

  test('point ledger allows one reward per user and quest version', async () => {
    const [quest] = (await dataSource.query(
      `
        SELECT id
        FROM quests
        WHERE code = 'typescript-type-narrowing' AND version = 1
      `,
    )) as Array<{ id: string }>

    const createCompletedAttempt = async () => {
      const [attempt] = (await dataSource.query(
        `
          INSERT INTO quest_attempts (
            user_id, quest_id, status, submitted_at, completed_at,
            score, passed, reward_points_snapshot
          )
          VALUES (
            $1, $2, 'COMPLETED', now(), now(), 100, true, 100
          )
          RETURNING id
        `,
        [testUserId, quest.id],
      )) as Array<{ id: string }>

      return attempt.id
    }

    const firstAttemptId = await createCompletedAttempt()
    await dataSource.query(
      `
        INSERT INTO point_ledger (
          user_id, quest_id, quest_attempt_id,
          entry_type, points, description
        )
        VALUES ($1, $2, $3, 'QUEST_REWARD', 100, '개발 퀴즈 완료')
      `,
      [testUserId, quest.id, firstAttemptId],
    )

    const secondAttemptId = await createCompletedAttempt()
    await assert.rejects(
      dataSource.query(
        `
          INSERT INTO point_ledger (
            user_id, quest_id, quest_attempt_id,
            entry_type, points, description
          )
          VALUES ($1, $2, $3, 'QUEST_REWARD', 100, '중복 보상')
        `,
        [testUserId, quest.id, secondAttemptId],
      ),
      (error: unknown) => hasPostgresCode(error, '23505'),
    )
  })
}
