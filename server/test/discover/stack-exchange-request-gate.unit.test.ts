import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DiscoverFetchError } from '../../src/discover/discover-http-client'
import { StackExchangeRequestGate } from '../../src/discover/stack-exchange-request-gate'

test('shares one-minute spacing and method backoff across callers', () => {
  let now = Date.UTC(2026, 6, 21, 10)
  const gate = new StackExchangeRequestGate({ now: () => now })

  gate.reserve(['questions/featured', 'questions/unanswered'])
  assert.throws(
    () => gate.reserve(['questions/featured']),
    (error) => error instanceof DiscoverFetchError && error.reason === 'RATE_LIMITED',
  )

  gate.recordResponse('questions/featured', 120, 100)
  now += 60_000
  assert.throws(
    () => gate.reserve(['questions/featured']),
    (error) => error instanceof DiscoverFetchError && error.reason === 'RATE_LIMITED',
  )
  gate.reserve(['questions/unanswered'])

  now += 60_000
  assert.doesNotThrow(() => gate.reserve(['questions/featured']))
})

test('blocks every method after quota exhaustion until the next UTC day', () => {
  let now = Date.UTC(2026, 6, 21, 23, 59)
  const gate = new StackExchangeRequestGate({ now: () => now })

  gate.reserve(['questions/featured'])
  gate.recordResponse('questions/featured', null, 0)
  assert.equal(gate.isQuotaExhausted(), true)
  assert.throws(
    () => gate.reserve(['questions/unanswered']),
    (error) => error instanceof DiscoverFetchError && error.reason === 'RATE_LIMITED',
  )

  now = Date.UTC(2026, 6, 22)
  assert.equal(gate.isQuotaExhausted(), false)
  assert.doesNotThrow(() => gate.reserve(['questions/unanswered']))
})
