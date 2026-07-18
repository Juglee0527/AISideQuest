import assert from 'node:assert/strict'
import test from 'node:test'

import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'

import type { AppEnvironment } from '../../src/config/environment'
import type { ApiIdempotencyService } from '../../src/common/idempotency/api-idempotency.service'
import type { DatabaseService } from '../../src/database/database.service'
import { QuestAttemptService } from '../../src/quests/quest-attempt.service'
import { IntegrationEventController } from '../../src/sessions/integration-event.controller'
import type { SessionService } from '../../src/sessions/session.service'

function disabledConfig(key: keyof AppEnvironment) {
  return {
    getOrThrow: (requested: keyof AppEnvironment) => requested === key ? false : true,
  } as ConfigService<AppEnvironment, true>
}

test('paused integration events return a retryable response before processing', () => {
  let processed = false
  let retryAfter = ''
  const controller = new IntegrationEventController(
    { processIntegrationEvent: () => { processed = true } } as unknown as SessionService,
    disabledConfig('INTEGRATION_EVENTS_ENABLED'),
  )

  assert.throws(
    () => controller.receiveEvent(
      {} as never,
      { setHeader: (_name: string, value: string) => { retryAfter = value } } as never,
      undefined,
      {} as never,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException)
      assert.equal(error.getStatus(), 503)
      assert.deepEqual(error.getResponse(), { code: 'INTEGRATION_EVENTS_PAUSED' })
      return true
    },
  )
  assert.equal(retryAfter, '60')
  assert.equal(processed, false)
})

test('paused rewards block submission before opening the grading transaction', async () => {
  let transactions = 0
  const service = new QuestAttemptService(
    { transaction: async () => { transactions += 1 } } as unknown as DatabaseService,
    {} as ApiIdempotencyService,
    disabledConfig('QUEST_REWARDS_ENABLED'),
  )

  await assert.rejects(
    service.submitAttempt('user-id', 'attempt-id', 'idempotency-key'),
    (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException)
      assert.equal(error.getStatus(), 503)
      assert.deepEqual(error.getResponse(), { code: 'QUEST_REWARDS_PAUSED' })
      return true
    },
  )
  assert.equal(transactions, 0)
})

