import assert from 'node:assert/strict'
import test from 'node:test'

import type { EntityManager } from 'typeorm'

import type { DatabaseService } from '../../src/database/database.service'
import { SessionRecoveryService } from '../../src/sessions/session-recovery.service'

function serviceWithResults(results: unknown[][], queries: string[]) {
  const manager = {
    query: async (sql: string) => {
      queries.push(sql)
      return results.shift() ?? []
    },
  } as unknown as EntityManager
  const database = {
    transaction: async <T>(work: (value: EntityManager) => Promise<T>) => work(manager),
  } as DatabaseService

  return new SessionRecoveryService(database)
}

test('runs fixed-boundary automatic, manual and orphan cleanup under one database lock', async () => {
  const queries: string[] = []
  const service = serviceWithResults([
    [{ locked: true }],
    [{ count: 2 }],
    [{ count: 3 }],
    [{ count: 4 }],
  ], queries)

  const result = await service.runCleanup()

  assert.deepEqual(result, {
    skipped: false,
    automaticSessionsExpired: 2,
    manualSessionsExpired: 3,
    orphanEventsIgnored: 4,
  })
  assert.match(queries[0], /pg_try_advisory_xact_lock/)
  assert.match(queries[1], /last_activity_at \+ interval '120 seconds'/)
  assert.match(queries[2], /started_at \+ interval '12 hours'/)
  assert.match(queries[3], /processing_result = 'IGNORED_ORPHAN'/)
})

test('skips cleanup when another server instance owns the advisory lock', async () => {
  const queries: string[] = []
  const service = serviceWithResults([[{ locked: false }]], queries)

  assert.deepEqual(await service.runCleanup(), {
    skipped: true,
    automaticSessionsExpired: 0,
    manualSessionsExpired: 0,
    orphanEventsIgnored: 0,
  })
  assert.equal(queries.length, 1)
})
