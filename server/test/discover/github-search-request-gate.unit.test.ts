import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DiscoverFetchError } from '../../src/discover/discover-http-client'
import { GithubSearchRequestGate } from '../../src/discover/github-search-request-gate'

test('blocks search until reset when the search bucket is exhausted', () => {
  let now = Date.UTC(2026, 6, 22, 10)
  const gate = new GithubSearchRequestGate({ now: () => now })
  const resetSeconds = Math.floor((now + 45_000) / 1_000)

  gate.recordResponse(new Headers({
    'x-ratelimit-resource': 'search',
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(resetSeconds),
  }))
  assert.throws(
    () => gate.reserve(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'RATE_LIMITED',
  )

  now = resetSeconds * 1_000
  assert.doesNotThrow(() => gate.reserve())
})

test('honors Retry-After-derived failures and rejects a non-search bucket', () => {
  let now = Date.UTC(2026, 6, 22, 10)
  const gate = new GithubSearchRequestGate({ now: () => now })
  gate.recordFailure(new DiscoverFetchError('RATE_LIMITED', now + 60_000))
  assert.throws(() => gate.reserve(), DiscoverFetchError)

  now += 60_000
  assert.doesNotThrow(() => gate.reserve())
  assert.throws(
    () => gate.recordResponse(new Headers({ 'x-ratelimit-resource': 'core' })),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )
})
