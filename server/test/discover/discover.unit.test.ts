import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BadRequestException } from '@nestjs/common'

import type { DiscoverSourceAdapter } from '../../src/discover/discover-adapter'
import type {
  DiscoverCacheEntry,
  DiscoverCacheService,
} from '../../src/discover/discover-cache.service'
import { DiscoverFetchError } from '../../src/discover/discover-http-client'
import type { DiscoverSavedService } from '../../src/discover/discover-saved.service'
import type { DiscoverInterestService } from '../../src/discover/discover-interest.service'
import { DiscoverService } from '../../src/discover/discover.service'
import type { DiscoverItem, DiscoverSource } from '../../src/discover/discover.types'
import type { OperationalLoggerService } from '../../src/observability/operational-logger.service'
import type { OperationalMetricsService } from '../../src/observability/operational-metrics.service'

const userId = '00000000-0000-4000-8000-000000000001'
const now = new Date('2026-07-20T08:00:00.000Z')

class FakeCacheService {
  readonly entries = new Map<DiscoverSource, DiscoverCacheEntry>()

  async read(source: DiscoverSource) {
    return this.entries.get(source) ?? null
  }

  async refreshWithLock(
    source: DiscoverSource,
    _freshForMs: number,
    fetchItems: () => Promise<DiscoverItem[]>,
  ) {
    const items = await fetchItems()
    const entry = { source, items, refreshedAt: now.toISOString() }
    this.entries.set(source, entry)
    return { lockAcquired: true, entry }
  }
}

function createService(
  adapters: DiscoverSourceAdapter[] = [],
  cache = new FakeCacheService(),
  interestTags: Array<'typescript' | 'python'> = [],
) {
  const metricEvents: string[] = []
  const metrics = {
    recordDiscoverCache: (source: string, result: string) => metricEvents.push(`cache:${source}:${result}`),
    recordDiscoverFetch: (source: string, result: string, reason?: string) => metricEvents.push(`fetch:${source}:${result}:${reason ?? ''}`),
  } as unknown as OperationalMetricsService
  const logger = { error: () => undefined } as unknown as OperationalLoggerService
  const savedService = {
    findSavedItemReferences: async () => [],
  } as unknown as DiscoverSavedService
  const interestService = {
    getInterests: async () => ({ tags: interestTags, updatedAt: null }),
  } as unknown as DiscoverInterestService
  return {
    service: new DiscoverService(
      adapters,
      cache as unknown as DiscoverCacheService,
      savedService,
      interestService,
      metrics,
      logger,
    ),
    cache,
    metricEvents,
  }
}

function item(
  id: string,
  source: DiscoverSource = 'HACKER_NEWS',
  publishedAt: string | null = now.toISOString(),
): DiscoverItem {
  return {
    id: `${source}:${id}`,
    source,
    category: source === 'REMOTIVE' ? 'EARNING' : 'NEWS',
    kind: source === 'REMOTIVE' ? 'PAID_JOB' : 'ARTICLE',
    title: id,
    summary: null,
    tags: [],
    reward: null,
    compensation: null,
    engagement: null,
    readingTimeMinutes: null,
    originalUrl: 'https://example.com/item',
    attribution: 'Example',
    publishedAt,
    fetchedAt: now.toISOString(),
  }
}

function adapter(
  source: DiscoverSource,
  fetchItems: () => Promise<DiscoverItem[]>,
): DiscoverSourceAdapter {
  return {
    source,
    displayName: source,
    categories: source === 'REMOTIVE' ? ['EARNING'] : ['NEWS'],
    cachePolicy: { freshForMs: 10 * 60_000, maxStaleMs: 24 * 60 * 60_000 },
    fetchItems,
  }
}

test('returns the explicit unavailable baseline before source adapters exist', async () => {
  const { service } = createService()
  const result = await service.listDiscover(userId, { limit: 20 })

  assert.deepEqual(result.items, [])
  assert.equal(result.nextCursor, null)
  assert.deepEqual(result.recommendations, [])
  assert.equal(result.sources.length, 6)
  assert.ok(result.sources.every((source) => !source.enabled && source.status === 'UNAVAILABLE'))
})

test('filters safe source metadata and rejects malformed cursors', async () => {
  const { service } = createService()
  const earning = await service.listDiscover(userId, { category: 'EARNING', limit: 20 })
  assert.deepEqual(earning.sources.map((source) => source.source), ['HACKER_NEWS', 'REMOTIVE', 'ALGORA'])

  await assert.rejects(
    service.listDiscover(userId, { cursor: 'invalid', limit: 20 }),
    (error) => error instanceof BadRequestException,
  )
})

test('uses a fresh cache without calling the adapter', async () => {
  const cache = new FakeCacheService()
  cache.entries.set('HACKER_NEWS', {
    source: 'HACKER_NEWS',
    items: [item('cached')],
    refreshedAt: new Date(Date.now() - 1_000).toISOString(),
  })
  let calls = 0
  const { service, metricEvents } = createService([
    adapter('HACKER_NEWS', async () => { calls += 1; return [] }),
  ], cache)

  const result = await service.listDiscover(userId, { limit: 20 })
  assert.equal(calls, 0)
  assert.deepEqual(result.items.map((value) => value.id), ['HACKER_NEWS:cached'])
  assert.equal(result.sources[0]?.enabled, true)
  assert.equal(result.sources[0]?.status, 'FRESH')
  assert.ok(metricEvents.includes('cache:HACKER_NEWS:FRESH'))
})

test('returns bounded stale data when refresh fails and isolates other sources', async () => {
  const cache = new FakeCacheService()
  cache.entries.set('HACKER_NEWS', {
    source: 'HACKER_NEWS',
    items: [item('stale')],
    refreshedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
  })
  const { service, metricEvents } = createService([
    adapter('HACKER_NEWS', async () => { throw new DiscoverFetchError('TIMEOUT') }),
    adapter('REMOTIVE', async () => [item('job', 'REMOTIVE')]),
  ], cache)

  const result = await service.listDiscover(userId, { limit: 20 })
  assert.deepEqual(new Set(result.items.map((value) => value.id)), new Set([
    'HACKER_NEWS:stale',
    'REMOTIVE:job',
  ]))
  assert.equal(result.sources.find((source) => source.source === 'HACKER_NEWS')?.status, 'STALE')
  assert.equal(result.sources.find((source) => source.source === 'REMOTIVE')?.status, 'FRESH')
  assert.ok(metricEvents.includes('fetch:HACKER_NEWS:FAILURE:TIMEOUT'))
})

test('deduplicates, sorts and paginates with a stable cursor', async () => {
  const values = [
    item('older', 'HACKER_NEWS', '2026-07-20T07:00:00.000Z'),
    item('newer', 'HACKER_NEWS', '2026-07-20T08:00:00.000Z'),
    item('newer', 'HACKER_NEWS', '2026-07-20T08:00:00.000Z'),
  ]
  const { service } = createService([adapter('HACKER_NEWS', async () => values)])

  const first = await service.listDiscover(userId, { limit: 1 })
  assert.deepEqual(first.items.map((value) => value.id), ['HACKER_NEWS:newer'])
  assert.ok(first.nextCursor)

  const second = await service.listDiscover(userId, { limit: 1, cursor: first.nextCursor as string })
  assert.deepEqual(second.items.map((value) => value.id), ['HACKER_NEWS:older'])
  assert.equal(second.nextCursor, null)
})

test('personalizes from explicit tags and rejects a cursor after interests change', async () => {
  const cache = new FakeCacheService()
  const newer = item('newer', 'HACKER_NEWS', '2026-07-20T08:00:00.000Z')
  const matched = {
    ...item('matched', 'HACKER_NEWS', '2026-07-19T08:00:00.000Z'),
    tags: ['typescript'],
    engagement: { type: 'SCORE' as const, value: 10 },
  }
  const personalized = createService([
    adapter('HACKER_NEWS', async () => [newer, matched]),
  ], cache, ['typescript'])

  const first = await personalized.service.listDiscover(userId, { limit: 1 })
  assert.deepEqual(first.items.map((value) => value.id), [matched.id])
  assert.deepEqual(first.recommendations, [{
    itemId: matched.id,
    reasons: ['INTEREST_MATCH', 'RECENT', 'EXTERNAL_ENGAGEMENT'],
    matchedInterests: ['typescript'],
  }])
  assert.ok(first.nextCursor)

  const defaultService = createService([
    adapter('HACKER_NEWS', async () => []),
  ], cache)
  await assert.rejects(
    defaultService.service.listDiscover(userId, {
      limit: 1,
      cursor: first.nextCursor as string,
    }),
    (error) => error instanceof BadRequestException,
  )
})

test('returns defensive source category copies', async () => {
  const { service } = createService()
  const first = await service.listSources()
  first.sources[0]?.categories.push('NEWS')
  const second = await service.listSources()
  assert.deepEqual(second.sources[0]?.categories, ['EARNING', 'NEWS', 'COMMUNITY'])
})
