import assert from 'node:assert/strict'
import test from 'node:test'

import type { EntityManager } from 'typeorm'

import type { DatabaseService } from '../../src/database/database.service'
import { QuestAttemptRecoveryService } from '../../src/quests/quest-attempt-recovery.service'
import { isWithinSubmissionGrace } from '../../src/quests/quest-attempt.service'

test('includes the exact five-minute submission boundary and excludes later times', () => {
  const endedAt = new Date('2026-07-18T00:00:00.000Z')
  assert.equal(
    isWithinSubmissionGrace(new Date('2026-07-18T00:05:00.000Z'), endedAt),
    true,
  )
  assert.equal(
    isWithinSubmissionGrace(new Date('2026-07-18T00:05:00.001Z'), endedAt),
    false,
  )
})

test('expires overdue attempts under a database advisory lock', async () => {
  const queries: string[] = []
  const manager = {
    query: async (sql: string) => {
      queries.push(sql)
      return queries.length === 1 ? [{ locked: true }] : [{ count: 3 }]
    },
  } as unknown as EntityManager
  const database = {
    transaction: async <T>(work: (value: EntityManager) => Promise<T>) => work(manager),
  } as DatabaseService
  const service = new QuestAttemptRecoveryService(database)

  assert.deepEqual(await service.runCleanup(), {
    skipped: false,
    attemptsExpired: 3,
  })
  assert.match(queries[0], /pg_try_advisory_xact_lock/)
  assert.match(queries[1], /interval '5 minutes'/)
})
