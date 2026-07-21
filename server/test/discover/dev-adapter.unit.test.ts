import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DevAdapter } from '../../src/discover/dev.adapter'
import {
  DiscoverFetchError,
  type DiscoverHttpClient,
  type DiscoverJsonRequest,
} from '../../src/discover/discover-http-client'
import { normalizeDiscoverItem } from '../../src/discover/discover-normalization'

class FakeHttpClient {
  response: unknown = []
  readonly requests: DiscoverJsonRequest[] = []

  async getJson(request: DiscoverJsonRequest) {
    this.requests.push(request)
    if (this.response instanceof Error) throw this.response
    return this.response
  }
}

function createAdapter() {
  const client = new FakeHttpClient()
  return {
    adapter: new DevAdapter(client as unknown as DiscoverHttpClient),
    client,
  }
}

function article(id: number, overrides: Record<string, unknown> = {}) {
  return {
    type_of: 'article',
    id,
    title: `Article ${id}`,
    description: '<p>Build <strong>reliable</strong> TypeScript services.</p>',
    tag_list: ['typescript', 'webdev'],
    url: `https://dev.to/example/article-${id}`,
    published_timestamp: '2026-07-21T01:02:03Z',
    positive_reactions_count: 42,
    reading_time_minutes: 5,
    ...overrides,
  }
}

test('normalizes DEV articles, tags, reading time and reactions without raw HTML', async () => {
  const { adapter, client } = createAdapter()
  client.response = [
    article(1, {
      title: '<b>TypeScript &amp; React</b>',
      tag_list: 'typescript, react, webdev',
    }),
    article(2, {
      description: null,
      positive_reactions_count: 1_000_000_001,
      reading_time_minutes: 0,
    }),
  ]

  const items = await adapter.fetchItems()
  assert.equal(items.length, 2)
  assert.doesNotThrow(() => items.map((item) => normalizeDiscoverItem(item, 'DEV')))
  assert.deepEqual(items[0] && {
    title: items[0].title,
    summary: items[0].summary,
    tags: items[0].tags,
    engagement: items[0].engagement,
    readingTimeMinutes: items[0].readingTimeMinutes,
    originalUrl: items[0].originalUrl,
    attribution: items[0].attribution,
  }, {
    title: 'TypeScript & React',
    summary: 'Build reliable TypeScript services.',
    tags: ['dev-community', 'typescript', 'react', 'webdev'],
    engagement: { type: 'REACTIONS', value: 42 },
    readingTimeMinutes: 5,
    originalUrl: 'https://dev.to/example/article-1',
    attribution: 'DEV Community',
  })
  assert.equal(items[1]?.summary, null)
  assert.equal(items[1]?.engagement, null)
  assert.equal(items[1]?.readingTimeMinutes, null)
  assert.doesNotMatch(JSON.stringify(items), /<\/?(?:p|b|strong)>/i)
})

test('keeps healthy empty responses and skips isolated invalid or duplicate articles', async () => {
  const { adapter, client } = createAdapter()
  assert.deepEqual(await adapter.fetchItems(), [])

  client.response = [
    article(10),
    article(10, { title: 'Duplicate' }),
    article(11, { url: 'https://example.com/not-dev' }),
    article(12, { title: '' }),
    article(13, { tag_list: { invalid: true } }),
  ]
  const items = await adapter.fetchItems()
  assert.deepEqual(items.map((item) => item.id), ['DEV:10', 'DEV:13'])
  assert.deepEqual(items[1]?.tags, ['dev-community', 'typescript'])
})

test('rejects malformed or broadly invalid payloads so stale cache is preserved', async () => {
  const { adapter, client } = createAdapter()
  client.response = { articles: [] }
  await assert.rejects(
    adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )

  client.response = [
    article(20, { type_of: 'podcast_episodes' }),
    article(21, { published_timestamp: 'not-a-date' }),
  ]
  await assert.rejects(
    adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )

  client.response = [
    article(30),
    article(31, { title: '' }),
    article(32, { url: 'http://dev.to/unsafe' }),
    article(33, { published_timestamp: 'not-a-date' }),
  ]
  await assert.rejects(
    adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )
})

test('uses one bounded public Forem V1 request and caps the first page', async () => {
  const { adapter, client } = createAdapter()
  client.response = Array.from({ length: 50 }, (_, index) => article(index + 1))

  const items = await adapter.fetchItems()
  assert.equal(items.length, 30)
  assert.deepEqual(adapter.cachePolicy, {
    freshForMs: 30 * 60_000,
    maxStaleMs: 24 * 60 * 60_000,
  })
  assert.deepEqual(client.requests, [{
    url: 'https://dev.to/api/articles?per_page=30',
    allowedHosts: ['dev.to'],
    accept: 'application/vnd.forem.api-v1+json',
    timeoutMs: 5_000,
    maxAttempts: 1,
    maxResponseBytes: 1_000_000,
  }])
})
