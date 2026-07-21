import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DiscoverFetchError,
  type DiscoverHttpClient,
  type DiscoverJsonRequest,
} from '../../src/discover/discover-http-client'
import { normalizeDiscoverItem } from '../../src/discover/discover-normalization'
import { StackExchangeRequestGate } from '../../src/discover/stack-exchange-request-gate'
import { StackOverflowAdapter } from '../../src/discover/stack-overflow.adapter'

class FakeHttpClient {
  readonly responses: unknown[] = []
  readonly requests: DiscoverJsonRequest[] = []

  async getJson(request: DiscoverJsonRequest) {
    this.requests.push(request)
    const response = this.responses.shift()
    if (response instanceof Error) throw response
    return response
  }
}

function createAdapter() {
  const client = new FakeHttpClient()
  const gate = new StackExchangeRequestGate({ now: () => Date.UTC(2026, 6, 21, 10) })
  return {
    adapter: new StackOverflowAdapter(client as unknown as DiscoverHttpClient, gate),
    client,
  }
}

function wrapper(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    items,
    has_more: false,
    quota_max: 300,
    quota_remaining: 299,
    ...overrides,
  }
}

function question(id: number, overrides: Record<string, unknown> = {}) {
  return {
    question_id: id,
    title: `Question ${id} about TypeScript`,
    tags: ['typescript', 'node.js'],
    link: `https://stackoverflow.com/questions/${id}/question-${id}`,
    creation_date: 1_753_056_123,
    score: 42,
    ...overrides,
  }
}

test('normalizes reputation bounties and unanswered discussions without cash claims', async () => {
  const { adapter, client } = createAdapter()
  client.responses.push(
    wrapper([question(10, { title: 'TypeScript &amp; Node.js', bounty_amount: 100 })]),
    wrapper([question(20, { score: -1 })]),
  )

  const items = await adapter.fetchItems()
  assert.equal(items.length, 2)
  assert.doesNotThrow(() => items.map((item) => normalizeDiscoverItem(item, 'STACK_EXCHANGE')))
  assert.deepEqual(items[0] && {
    title: items[0].title,
    kind: items[0].kind,
    reward: items[0].reward,
    compensation: items[0].compensation,
    engagement: items[0].engagement,
    tags: items[0].tags,
    attribution: items[0].attribution,
  }, {
    title: 'TypeScript & Node.js',
    kind: 'REPUTATION_BOUNTY',
    reward: { type: 'REPUTATION_BOUNTY', amount: 100 },
    compensation: null,
    engagement: { type: 'SCORE', value: 42 },
    tags: ['stack-overflow', 'typescript', 'node.js', 'javascript'],
    attribution: 'Stack Overflow',
  })
  assert.equal(items[1]?.kind, 'DISCUSSION')
  assert.equal(items[1]?.reward, null)
  assert.equal(items[1]?.engagement, null)
})

test('uses two fixed bounded requests and never follows has_more', async () => {
  const { adapter, client } = createAdapter()
  client.responses.push(wrapper([], { has_more: true }), wrapper([], { has_more: true }))

  assert.deepEqual(await adapter.fetchItems(), [])
  assert.deepEqual(adapter.cachePolicy, {
    freshForMs: 15 * 60_000,
    maxStaleMs: 24 * 60 * 60_000,
  })
  assert.deepEqual(client.requests, [
    {
      url: 'https://api.stackexchange.com/2.3/questions/featured?page=1&pagesize=30&order=desc&sort=creation&site=stackoverflow',
      allowedHosts: ['api.stackexchange.com'],
      timeoutMs: 5_000,
      maxAttempts: 1,
      maxResponseBytes: 1_000_000,
    },
    {
      url: 'https://api.stackexchange.com/2.3/questions/unanswered?page=1&pagesize=30&order=desc&sort=creation&site=stackoverflow',
      allowedHosts: ['api.stackexchange.com'],
      timeoutMs: 5_000,
      maxAttempts: 1,
      maxResponseBytes: 1_000_000,
    },
  ])
})

test('deduplicates pages, skips isolated invalid questions and fails refresh on exhausted quota', async () => {
  const { adapter, client } = createAdapter()
  client.responses.push(wrapper([
    question(30, { bounty_amount: 50 }),
    question(31, { bounty_amount: 50, link: 'https://example.com/unsafe' }),
  ], { quota_remaining: 0 }))

  await assert.rejects(
    adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'RATE_LIMITED',
  )
  assert.equal(client.requests.length, 1)

  const second = createAdapter()
  second.client.responses.push(
    wrapper([question(40, { bounty_amount: 50 })]),
    wrapper([question(40), question(41)]),
  )
  assert.deepEqual(
    (await second.adapter.fetchItems()).map((item) => item.id),
    ['STACK_EXCHANGE:40', 'STACK_EXCHANGE:41'],
  )
})

test('rejects malformed wrappers and broadly invalid question pages', async () => {
  const malformed = createAdapter()
  malformed.client.responses.push({ items: [], quota_remaining: 10 })
  await assert.rejects(
    malformed.adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )

  const invalid = createAdapter()
  invalid.client.responses.push(wrapper([
    question(50, { bounty_amount: null }),
    question(51, { bounty_amount: -1 }),
    question(52, { bounty_amount: '100' }),
  ]))
  await assert.rejects(
    invalid.adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )
})
