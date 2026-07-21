import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DiscoverFetchError,
  type DiscoverHttpClient,
  type DiscoverJsonRequest,
} from '../../src/discover/discover-http-client'
import { normalizeDiscoverItem } from '../../src/discover/discover-normalization'
import { RemotiveAdapter } from '../../src/discover/remotive.adapter'

class FakeHttpClient {
  response: unknown = { jobs: [] }
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
    adapter: new RemotiveAdapter(client as unknown as DiscoverHttpClient),
    client,
  }
}

function job(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    url: `https://remotive.com/remote-jobs/software-dev/job-${id}`,
    title: `Developer ${id}`,
    company_name: `Company ${id}`,
    category: 'Software Development',
    job_type: 'full_time',
    publication_date: '2026-07-21T01:02:03',
    candidate_required_location: 'Worldwide',
    salary: '$100,000 - $120,000',
    description: '<p>Build <strong>reliable</strong> software.</p>',
    ...overrides,
  }
}

test('normalizes salary, location and supported employment types without inference', async () => {
  const { adapter, client } = createAdapter()
  client.response = {
    jobs: [
      job(1, { title: 'TypeScript Developer', salary: '<b>$100k &amp; equity</b>' }),
      job(2, {
        job_type: 'freelance',
        salary: '',
        description: '<p>Potential budget $200k, depending on scope.</p>',
      }),
      job(3, { job_type: 'contract', salary: '   ' }),
    ],
  }

  const items = await adapter.fetchItems()
  assert.equal(items.length, 3)
  assert.doesNotThrow(() => items.map((item) => normalizeDiscoverItem(item, 'REMOTIVE')))
  assert.deepEqual(items[0]?.compensation, {
    provided: true,
    text: '$100k & equity',
  })
  assert.deepEqual(items[1]?.compensation, { provided: false, text: null })
  assert.ok(items[1]?.summary?.includes('Potential budget $200k'))
  assert.ok(items[0]?.tags.includes('full-time'))
  assert.ok(items[0]?.tags.includes('typescript'))
  assert.ok(items[1]?.tags.includes('freelance'))
  assert.ok(items[2]?.tags.includes('contract'))
  assert.equal(items[0]?.publishedAt, '2026-07-21T01:02:03.000Z')
  assert.equal(items[0]?.attribution, 'Remotive')
  assert.equal(items[0]?.originalUrl, 'https://remotive.com/remote-jobs/software-dev/job-1')
  assert.equal(items[0]?.engagement, null)
  assert.doesNotMatch(JSON.stringify(items), /<\/?(?:p|b|strong)>/i)
})

test('deduplicates IDs and skips isolated invalid jobs', async () => {
  const { adapter, client } = createAdapter()
  client.response = {
    jobs: [
      job(10),
      job(10, { title: 'Duplicate' }),
      job(11, { title: '' }),
      job(12, { url: 'https://example.com/not-remotive' }),
      job(13, { job_type: 'unknown', salary: undefined }),
    ],
  }

  const items = await adapter.fetchItems()
  assert.deepEqual(items.map((item) => item.id), ['REMOTIVE:10', 'REMOTIVE:13'])
  assert.deepEqual(items[1]?.tags, ['remote', 'software-development'])
  assert.deepEqual(items[1]?.compensation, { provided: false, text: null })
})

test('rejects malformed or wholly invalid payloads so stale cache is preserved', async () => {
  const { adapter, client } = createAdapter()
  client.response = { jobs: 'not-an-array' }
  await assert.rejects(
    adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )

  client.response = {
    jobs: [
      job(20, { category: 'Marketing' }),
      job(21, { publication_date: 'not-a-date' }),
    ],
  }
  await assert.rejects(
    adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )

  client.response = {
    jobs: [
      job(30),
      job(31, { category: 'Marketing' }),
      job(32, { title: '' }),
      job(33, { url: 'https://example.com/not-remotive' }),
    ],
  }
  await assert.rejects(
    adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )
})

test('uses one bounded software-development API request and caps normalized jobs', async () => {
  const { adapter, client } = createAdapter()
  client.response = {
    jobs: Array.from({ length: 50 }, (_, index) => job(index + 1)),
  }

  const items = await adapter.fetchItems()
  assert.equal(items.length, 30)
  assert.equal(client.requests.length, 1)
  assert.deepEqual(client.requests[0], {
    url: 'https://remotive.com/api/remote-jobs?category=software-dev&limit=30',
    allowedHosts: ['remotive.com'],
    timeoutMs: 5_000,
    maxAttempts: 1,
    maxResponseBytes: 1_000_000,
  })
})
