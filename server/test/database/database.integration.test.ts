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
      'api_idempotency_keys',
      'auth_sessions',
      'device_link_codes',
      'device_link_requests',
      'devices',
      'discover_analytics_events',
      'discover_saved_items',
      'discover_source_cache',
      'discover_user_interests',
      'integration_events',
      'oauth_login_states',
      'point_ledger',
      'quest_attempt_answers',
      'quest_attempts',
      'quest_options',
      'quest_questions',
      'quests',
      'rate_limit_buckets',
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
    const [discoverAnalyticsReverted] = (await dataSource.query(`
      SELECT to_regclass('public.discover_analytics_events') AS analytics_table
    `)) as Array<{ analytics_table: string | null }>
    assert.equal(discoverAnalyticsReverted.analytics_table, null)

    await dataSource.undoLastMigration()
    const [discoverInterestsReverted] = (await dataSource.query(`
      SELECT to_regclass('public.discover_user_interests') AS interests_table
    `)) as Array<{ interests_table: string | null }>
    assert.equal(discoverInterestsReverted.interests_table, null)

    await dataSource.undoLastMigration()
    const [discoverSavedItemsReverted] = (await dataSource.query(`
      SELECT to_regclass('public.discover_saved_items') AS saved_items_table
    `)) as Array<{ saved_items_table: string | null }>
    assert.equal(discoverSavedItemsReverted.saved_items_table, null)

    await dataSource.undoLastMigration()
    const [discoverCacheReverted] = (await dataSource.query(`
      SELECT to_regclass('public.discover_source_cache') AS cache_table
    `)) as Array<{ cache_table: string | null }>
    assert.equal(discoverCacheReverted.cache_table, null)

    await dataSource.undoLastMigration()
    const [sanitizedContextReverted] = (await dataSource.query(`
      SELECT count(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('ai_sessions', 'integration_events')
        AND column_name IN ('workspace_label', 'operation_label')
    `)) as Array<{ count: number }>
    assert.equal(sanitizedContextReverted.count, 0)

    await dataSource.undoLastMigration()
    const [concurrentSessionsReverted] = (await dataSource.query(`
      SELECT
        to_regclass('public.uk_ai_sessions_active_user') AS legacy_index,
        to_regclass('public.uk_ai_sessions_active_external_session') AS concurrent_index
    `)) as Array<{ legacy_index: string | null; concurrent_index: string | null }>
    assert.deepEqual(concurrentSessionsReverted, {
      legacy_index: 'uk_ai_sessions_active_user',
      concurrent_index: null,
    })

    await dataSource.undoLastMigration()
    const [browserLinkingReverted] = (await dataSource.query(`
      SELECT
        to_regclass('public.device_link_requests') AS request_table,
        (SELECT count(*)::integer
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'oauth_login_states'
           AND column_name = 'return_path') AS return_path_column
    `)) as Array<{ request_table: string | null; return_path_column: number }>
    assert.deepEqual(browserLinkingReverted, {
      request_table: null,
      return_path_column: 0,
    })

    await dataSource.undoLastMigration()
    const [diagnosticsReverted] = (await dataSource.query(`
      SELECT count(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'devices'
        AND column_name = 'diagnostics_reported_at'
    `)) as Array<{ count: number }>
    assert.equal(diagnosticsReverted.count, 0)

    await dataSource.undoLastMigration()
    const [securityReverted] = (await dataSource.query(`
      SELECT to_regclass('public.rate_limit_buckets') AS rate_limit_table
    `)) as Array<{ rate_limit_table: string | null }>
    assert.equal(securityReverted.rate_limit_table, null)

    await dataSource.undoLastMigration()
    const [statisticsReverted] = (await dataSource.query(`
      SELECT
        (SELECT count(*)::integer
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name = 'time_zone_verified') AS verified_column,
        to_regclass('public.ix_ai_sessions_user_interval') AS session_index,
        to_regclass('public.ix_quest_attempts_user_completed_passed') AS attempt_index
    `)) as Array<{
      verified_column: number
      session_index: string | null
      attempt_index: string | null
    }>
    assert.deepEqual(statisticsReverted, {
      verified_column: 0,
      session_index: null,
      attempt_index: null,
    })

    await dataSource.undoLastMigration()
    const [legacyLedgerIndex] = (await dataSource.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'ix_point_ledger_user_created'
    `)) as Array<{ indexdef: string }>
    assert.doesNotMatch(legacyLedgerIndex.indexdef, /id DESC/)

    await seedDevelopmentQuests(dataSource)
    const [migrationUser] = (await dataSource.query(`
      INSERT INTO users (display_name)
      VALUES ('Point migration user')
      RETURNING id
    `)) as Array<{ id: string }>
    const [migrationSession] = (await dataSource.query(`
      INSERT INTO ai_sessions (
        user_id, status, origin, ended_at, terminal_reason
      ) VALUES ($1, 'COMPLETED', 'MANUAL', now(), 'MANUAL_COMPLETED')
      RETURNING id
    `, [migrationUser.id])) as Array<{ id: string }>
    const [migrationQuest] = (await dataSource.query(`
      SELECT id FROM quests WHERE code = 'typescript-type-narrowing'
    `)) as Array<{ id: string }>
    const [migrationAttempt] = (await dataSource.query(`
      INSERT INTO quest_attempts (
        user_id, quest_id, ai_session_id, status,
        submitted_at, completed_at, score, passed, reward_points_snapshot
      ) VALUES ($1, $2, $3, 'COMPLETED', now(), now(), 100, true, 100)
      RETURNING id
    `, [migrationUser.id, migrationQuest.id, migrationSession.id])) as Array<{ id: string }>

    const pointMigrations = await dataSource.runMigrations()
    assert.equal(pointMigrations.length, 11)
    const [backfill] = (await dataSource.query(`
      SELECT points, quest_attempt_id
      FROM point_ledger
      WHERE user_id = $1
    `, [migrationUser.id])) as Array<{ points: number; quest_attempt_id: string }>
    assert.deepEqual(backfill, { points: 100, quest_attempt_id: migrationAttempt.id })
    const [ledgerIndex] = (await dataSource.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'ix_point_ledger_user_created'
    `)) as Array<{ indexdef: string }>
    assert.match(ledgerIndex.indexdef, /user_id, created_at DESC, id DESC/)

    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.query('DELETE FROM point_ledger')
    await dataSource.query('DELETE FROM quest_attempts WHERE id = $1', [migrationAttempt.id])
    await dataSource.query('DELETE FROM ai_sessions WHERE id = $1', [migrationSession.id])
    await dataSource.query('DELETE FROM users WHERE id = $1', [migrationUser.id])

    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    await dataSource.undoLastMigration()
    const [attemptFlowReverted] = (await dataSource.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'quest_attempt_answers'
        AND column_name = 'is_correct'
    `)) as Array<{ is_nullable: string }>
    assert.equal(attemptFlowReverted.is_nullable, 'NO')

    await dataSource.undoLastMigration()
    const [questListingReverted] = (await dataSource.query(`
      SELECT count(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'quests'
        AND column_name = 'retry_allowed'
    `)) as Array<{ count: number }>
    assert.equal(questListingReverted.count, 0)

    await dataSource.undoLastMigration()
    const [heartbeatReverted] = (await dataSource.query(`
      SELECT count(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'integration_events'
        AND column_name = 'sequence'
    `)) as Array<{ count: number }>
    assert.equal(heartbeatReverted.count, 0)

    await dataSource.undoLastMigration()
    const [deviceLinkingReverted] = (await dataSource.query(`
      SELECT
        to_regclass('public.device_link_codes') AS device_link_codes_table,
        to_regclass('public.api_idempotency_keys') AS idempotency_table
    `)) as Array<{
      device_link_codes_table: string | null
      idempotency_table: string | null
    }>
    assert.equal(deviceLinkingReverted.device_link_codes_table, null)
    assert.equal(
      deviceLinkingReverted.idempotency_table,
      'api_idempotency_keys',
    )

    await dataSource.undoLastMigration()
    const [sessionApiReverted] = (await dataSource.query(`
      SELECT
        to_regclass('public.api_idempotency_keys') AS idempotency_table,
        to_regclass('public.auth_sessions') AS auth_sessions_table
    `)) as Array<{
      idempotency_table: string | null
      auth_sessions_table: string | null
    }>
    assert.equal(sessionApiReverted.idempotency_table, null)
    assert.equal(sessionApiReverted.auth_sessions_table, 'auth_sessions')

    await dataSource.undoLastMigration()
    const [authReverted] = (await dataSource.query(`
      SELECT
        to_regclass('public.auth_sessions') AS auth_sessions_table,
        to_regclass('public.users') AS users_table
    `)) as Array<{
      auth_sessions_table: string | null
      users_table: string | null
    }>
    assert.equal(authReverted.auth_sessions_table, null)
    assert.equal(authReverted.users_table, 'users')

    await dataSource.undoLastMigration()
    const [schemaReverted] = (await dataSource.query(
      "SELECT to_regclass('public.users') AS users_table",
    )) as Array<{ users_table: string | null }>
    assert.equal(schemaReverted.users_table, null)

    const reappliedMigrations = await dataSource.runMigrations()
    assert.equal(reappliedMigrations.length, 18)
  })

  test('discover cache stores only allowlisted normalized item arrays', async () => {
    await dataSource.query(`
      INSERT INTO discover_source_cache (source, items, refreshed_at)
      VALUES ('HACKER_NEWS', '[]'::jsonb, now())
    `)
    const [row] = (await dataSource.query(`
      SELECT source, items
      FROM discover_source_cache
      WHERE source = 'HACKER_NEWS'
    `)) as Array<{ source: string; items: unknown }>
    assert.deepEqual(row, { source: 'HACKER_NEWS', items: [] })

    await assert.rejects(
      dataSource.query(`
        INSERT INTO discover_source_cache (source, items, refreshed_at)
        VALUES ('UNKNOWN', '[]'::jsonb, now())
      `),
      (error) => hasPostgresCode(error, '23514'),
    )
    await assert.rejects(
      dataSource.query(`
        UPDATE discover_source_cache
        SET items = '{}'::jsonb
        WHERE source = 'HACKER_NEWS'
      `),
      (error) => hasPostgresCode(error, '23514'),
    )
  })

  test('discover interests enforce the fixed tag allowlist and maximum count', async () => {
    const [user] = (await dataSource.query(`
      INSERT INTO users (display_name)
      VALUES ('Discover interest constraint user')
      RETURNING id
    `)) as Array<{ id: string }>
    await dataSource.query(`
      INSERT INTO discover_user_interests (user_id, tags)
      VALUES ($1, ARRAY['typescript', 'react']::text[])
    `, [user.id])

      await assert.rejects(
        dataSource.query(`
          UPDATE discover_user_interests
        SET tags = ARRAY['not-allowed']::text[]
        WHERE user_id = $1
      `, [user.id]),
      (error) => hasPostgresCode(error, '23514'),
    )
    await assert.rejects(
      dataSource.query(`
        UPDATE discover_user_interests
        SET tags = ARRAY[
          'javascript', 'typescript', 'react', 'node.js', 'python', 'java',
          'go', 'rust', 'csharp', 'cpp', 'mobile'
        ]::text[]
        WHERE user_id = $1
      `, [user.id]),
        (error) => hasPostgresCode(error, '23514'),
      )
      await assert.rejects(
        dataSource.query(`
          UPDATE discover_user_interests
          SET tags = ARRAY['typescript', 'typescript']::text[]
          WHERE user_id = $1
        `, [user.id]),
        (error) => hasPostgresCode(error, '23514'),
      )
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

  test('database allows concurrent hook sessions but only one per external session', async () => {
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

    await dataSource.query(
      `
        INSERT INTO ai_sessions (
          user_id, status, origin, external_session_key, external_turn_key
        )
        VALUES ($1, 'RUNNING', 'HOOK', $2, $3)
      `,
      [testUserId, 'a'.repeat(64), 'b'.repeat(64)],
    )

    await dataSource.query(
      `
        INSERT INTO ai_sessions (
          user_id, status, origin, external_session_key, external_turn_key
        )
        VALUES ($1, 'WAITING_FOR_USER', 'HOOK', $2, $3)
      `,
      [testUserId, 'c'.repeat(64), 'd'.repeat(64)],
    )

    await assert.rejects(
      dataSource.query(
        `
          INSERT INTO ai_sessions (
            user_id, status, origin, external_session_key, external_turn_key
          )
          VALUES ($1, 'RUNNING', 'HOOK', $2, $3)
        `,
        [testUserId, 'a'.repeat(64), 'e'.repeat(64)],
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

    const insertEvent = (sequence = 1) =>
      dataSource.query(
        `
          INSERT INTO integration_events (
            event_id, sequence, device_id, user_id, event,
            external_session_key, external_turn_key,
            observed_at, processing_result, request_hash
          )
          VALUES (
            $1, $7, $2, $3, 'UserPromptSubmit', $4, $5,
            now(), 'APPLIED', $6
          )
        `,
        [...eventParameters, sequence],
      )

    await insertEvent()
    await dataSource.query(
      `UPDATE integration_events
       SET workspace_label = 'AISideQuest', operation_label = 'npm test'
       WHERE device_id = $1 AND event_id = $2`,
      [device.id, eventId],
    )

    await assert.rejects(
      dataSource.query(
        `UPDATE integration_events SET workspace_label = $1
         WHERE device_id = $2 AND event_id = $3`,
        ['C:\\private\\source', device.id, eventId],
      ),
      (error: unknown) => hasPostgresCode(error, '23514'),
    )

    await assert.rejects(
      dataSource.query(
        `UPDATE integration_events SET operation_label = $1
         WHERE device_id = $2 AND event_id = $3`,
        ['curl --token secret', device.id, eventId],
      ),
      (error: unknown) => hasPostgresCode(error, '23514'),
    )

    await assert.rejects(
      dataSource.query(
        'UPDATE ai_sessions SET workspace_label = $1 WHERE user_id = $2',
        ['C:\\private\\source', testUserId],
      ),
      (error: unknown) => hasPostgresCode(error, '23514'),
    )

    await assert.rejects(insertEvent(), (error: unknown) =>
      hasPostgresCode(error, '23505'),
    )

    await assert.rejects(
      dataSource.query(
        `
          INSERT INTO integration_events (
            event_id, sequence, device_id, user_id, event,
            external_session_key, external_turn_key,
            observed_at, processing_result, request_hash
          )
          VALUES (
            $1, 1, $2, $3, 'UserPromptSubmit', $4, $5,
            now(), 'APPLIED', $6
          )
        `,
        [randomUUID(), ...eventParameters.slice(1)],
      ),
      (error: unknown) => hasPostgresCode(error, '23505'),
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
