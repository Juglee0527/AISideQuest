import assert from 'node:assert/strict'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import { test } from 'node:test'

import {
  DiscoverFetchError,
  type DiscoverJsonRequest,
  type DiscoverHttpClient,
} from '../../src/discover/discover-http-client'
import { HackerNewsAdapter } from '../../src/discover/hacker-news.adapter'
import { normalizeDiscoverItem } from '../../src/discover/discover-normalization'

class FakeHttpClient {
  readonly responses = new Map<string, unknown>()
  readonly requests: DiscoverJsonRequest[] = []
  activeItemRequests = 0
  maxActiveItemRequests = 0

  async getJson(request: DiscoverJsonRequest) {
    this.requests.push(request)
    const path = new URL(request.url).pathname
    const isItem = path.includes('/item/')
    if (isItem) {
      this.activeItemRequests += 1
      this.maxActiveItemRequests = Math.max(
        this.maxActiveItemRequests,
        this.activeItemRequests,
      )
      await waitForImmediate()
    }
    try {
      const response = this.responses.get(path)
      if (response instanceof Error) throw response
      if (!this.responses.has(path)) {
        throw new Error(`Missing fake response for ${path}`)
      }
      return response
    } finally {
      if (isItem) this.activeItemRequests -= 1
    }
  }
}

function createAdapter(client = new FakeHttpClient()) {
  return {
    adapter: new HackerNewsAdapter(client as unknown as DiscoverHttpClient),
    client,
  }
}

function setFeeds(
  client: FakeHttpClient,
  feeds: { top?: number[]; show?: number[]; ask?: number[]; jobs?: number[] },
) {
  client.responses.set('/v0/topstories.json', feeds.top ?? [])
  client.responses.set('/v0/showstories.json', feeds.show ?? [])
  client.responses.set('/v0/askstories.json', feeds.ask ?? [])
  client.responses.set('/v0/jobstories.json', feeds.jobs ?? [])
}

function story(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'story',
    time: 1_752_998_400 + id,
    title: `Story ${id}`,
    url: `https://example.com/${id}`,
    ...overrides,
  }
}

test('normalizes Top, Ask, Show and Jobs with specific-feed precedence', async () => {
  const { adapter, client } = createAdapter()
  setFeeds(client, {
    top: [1, 2, 4, 6],
    show: [4],
    ask: [2, 3],
    jobs: [1, 5],
  })
  client.responses.set('/v0/item/1.json', {
    ...story(1),
    type: 'job',
    title: '<b>Job one</b>',
    text: '<p>Build &amp; ship</p>',
    score: 42,
    url: '',
  })
  client.responses.set('/v0/item/2.json', story(2, { url: undefined }))
  client.responses.set('/v0/item/3.json', story(3))
  client.responses.set('/v0/item/4.json', story(4))
  client.responses.set('/v0/item/5.json', {
    ...story(5),
    type: 'job',
    url: undefined,
  })
  client.responses.set('/v0/item/6.json', story(6))

  const items = await adapter.fetchItems()
  assert.equal(items.length, 6)
  assert.equal(new Set(items.map((item) => item.id)).size, 6)
  assert.doesNotThrow(() => items.map((item) => normalizeDiscoverItem(item, 'HACKER_NEWS')))

  const job = items.find((item) => item.id === 'HACKER_NEWS:1')
  assert.deepEqual(
    job && {
      category: job.category,
      kind: job.kind,
      title: job.title,
      summary: job.summary,
      compensation: job.compensation,
      engagement: job.engagement,
      originalUrl: job.originalUrl,
    },
    {
      category: 'EARNING',
      kind: 'PAID_JOB',
      title: 'Job one',
      summary: 'Build & ship',
      compensation: { provided: false, text: null },
      engagement: { type: 'SCORE', value: 42 },
      originalUrl: 'https://news.ycombinator.com/item?id=1',
    },
  )
  assert.equal(items.find((item) => item.id === 'HACKER_NEWS:2')?.category, 'COMMUNITY')
  assert.equal(items.find((item) => item.id === 'HACKER_NEWS:4')?.tags.at(-1), 'show-hn')
  assert.equal(items.find((item) => item.id === 'HACKER_NEWS:6')?.tags.at(-1), 'top')
  assert.ok(items.every((item) => item.attribution === 'Hacker News'))

  const itemPaths = client.requests
    .map((request) => new URL(request.url).pathname)
    .filter((path) => path.includes('/item/'))
  assert.equal(itemPaths.length, 6)
  assert.equal(new Set(itemPaths).size, 6)
})

test('skips deleted, dead and incomplete items and falls back from unsafe URLs', async () => {
  const { adapter, client } = createAdapter()
  setFeeds(client, { top: [10, 11, 12, 13, 14] })
  client.responses.set('/v0/item/10.json', null)
  client.responses.set('/v0/item/11.json', story(11, { deleted: true }))
  client.responses.set('/v0/item/12.json', story(12, { dead: true }))
  client.responses.set('/v0/item/13.json', story(13, { title: '' }))
  client.responses.set('/v0/item/14.json', story(14, { url: 'http://example.com/14' }))

  const items = await adapter.fetchItems()
  assert.deepEqual(items.map((item) => item.id), ['HACKER_NEWS:14'])
  assert.equal(items[0]?.originalUrl, 'https://news.ycombinator.com/item?id=14')
  assert.equal(items[0]?.publishedAt, '2025-07-20T08:00:14.000Z')
})

test('rejects malformed feed responses without replacing the shared cache', async () => {
  const { adapter, client } = createAdapter()
  client.responses.set('/v0/topstories.json', ['not-an-id'])
  client.responses.set('/v0/showstories.json', [])
  client.responses.set('/v0/askstories.json', [])
  client.responses.set('/v0/jobstories.json', [])

  await assert.rejects(
    adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )
})

test('keeps minor item failures partial but rejects a broad detail outage', async () => {
  const minor = createAdapter()
  setFeeds(minor.client, { top: [20, 21, 22, 23] })
  minor.client.responses.set('/v0/item/20.json', new DiscoverFetchError('TIMEOUT'))
  for (const id of [21, 22, 23]) minor.client.responses.set(`/v0/item/${id}.json`, story(id))
  assert.equal((await minor.adapter.fetchItems()).length, 3)

  const broad = createAdapter()
  setFeeds(broad.client, { top: [30, 31, 32, 33] })
  broad.client.responses.set('/v0/item/30.json', new DiscoverFetchError('TIMEOUT'))
  broad.client.responses.set('/v0/item/31.json', new DiscoverFetchError('TIMEOUT'))
  broad.client.responses.set('/v0/item/32.json', story(32))
  broad.client.responses.set('/v0/item/33.json', story(33))
  await assert.rejects(
    broad.adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'TIMEOUT',
  )
})

test('bounds refresh request volume and item concurrency', async () => {
  const { adapter, client } = createAdapter()
  const range = (start: number) => Array.from({ length: 100 }, (_, index) => start + index)
  setFeeds(client, {
    top: range(1),
    show: range(101),
    ask: range(201),
    jobs: range(301),
  })
  for (const id of [...range(1), ...range(101), ...range(201)]) {
    client.responses.set(`/v0/item/${id}.json`, story(id))
  }
  for (const id of range(301)) {
    client.responses.set(`/v0/item/${id}.json`, { ...story(id), type: 'job' })
  }

  const items = await adapter.fetchItems()
  assert.equal(items.length, 48)
  assert.equal(client.requests.length, 52)
  assert.ok(client.maxActiveItemRequests <= 8)
  assert.ok(client.requests.every((request) =>
    request.allowedHosts.length === 1
    && request.allowedHosts[0] === 'hacker-news.firebaseio.com'))
  assert.ok(client.requests
    .filter((request) => new URL(request.url).pathname.includes('/item/'))
    .every((request) => request.maxAttempts === 1))
})
