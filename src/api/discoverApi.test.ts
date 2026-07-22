import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from './apiClient'
import {
  deleteSavedDiscoverItem,
  getDiscoverPage,
  getDiscoverInterests,
  getDiscoverSources,
  getSavedDiscoverItems,
  saveDiscoverItem,
  recordDiscoverAnalyticsEvent,
  updateDiscoverInterests,
} from './discoverApi'

const serverTime = '2026-07-20T08:00:00.000Z'
const unavailableRemotive = {
  source: 'REMOTIVE',
  displayName: 'Remotive',
  categories: ['EARNING'],
  enabled: false,
  status: 'UNAVAILABLE',
  fetchedAt: null,
}

function response(data: unknown) {
  return new Response(JSON.stringify({ data, meta: { serverTime } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Discover API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends explicit filters and accepts the pre-adapter empty contract', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => response({
      items: [],
      nextCursor: null,
      savedItems: [],
      recommendations: [],
      sources: [unavailableRemotive],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await getDiscoverPage({
      category: 'EARNING',
      source: 'REMOTIVE',
      limit: 10,
      cursor: 'opaque-cursor',
    })

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requestedUrl.searchParams.get('category')).toBe('EARNING')
    expect(requestedUrl.searchParams.get('source')).toBe('REMOTIVE')
    expect(requestedUrl.searchParams.get('limit')).toBe('10')
    expect(requestedUrl.searchParams.get('cursor')).toBe('opaque-cursor')
    expect(result.data).toEqual({
      items: [],
      nextCursor: null,
      savedItems: [],
      recommendations: [],
      sources: [unavailableRemotive],
    })
  })

  it('parses compensation and verified rewards as different contracts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      items: [
        {
          id: 'REMOTIVE:job_123',
          source: 'REMOTIVE',
          category: 'EARNING',
          kind: 'PAID_JOB',
          title: 'Remote TypeScript Engineer',
          summary: null,
          tags: ['typescript'],
          reward: null,
          compensation: { provided: true, text: '$100k-$120k yearly' },
          engagement: null,
          readingTimeMinutes: 7,
          originalUrl: 'https://remotive.com/remote-jobs/software-dev/example',
          attribution: 'Remotive',
          publishedAt: '2026-07-19T08:00:00.000Z',
          fetchedAt: serverTime,
        },
        {
          id: 'ALGORA:bounty_456',
          source: 'ALGORA',
          category: 'EARNING',
          kind: 'CASH_BOUNTY',
          title: 'Implement feature',
          summary: 'Verified active bounty',
          tags: [],
          reward: { type: 'CASH_BOUNTY', amountMinor: 10_000, currency: 'USD' },
          compensation: null,
          engagement: null,
          readingTimeMinutes: null,
          originalUrl: 'https://console.algora.io/bounties/example',
          attribution: 'Algora',
          publishedAt: null,
          fetchedAt: serverTime,
        },
      ],
      nextCursor: null,
      savedItems: [],
      recommendations: [],
      sources: [{
        ...unavailableRemotive,
        enabled: true,
        status: 'FRESH',
        fetchedAt: serverTime,
      }],
    })))

    const result = await getDiscoverPage()
    expect(result.data.items[0]?.compensation).toEqual({
      provided: true,
      text: '$100k-$120k yearly',
    })
    expect(result.data.items[0]?.readingTimeMinutes).toBe(7)
    expect(result.data.items[1]?.reward).toEqual({
      type: 'CASH_BOUNTY',
      amountMinor: 10_000,
      currency: 'USD',
    })
  })

  it('rejects unsafe links and inconsistent reward classification', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      items: [{
        id: 'REMOTIVE:job_123',
        source: 'REMOTIVE',
        category: 'EARNING',
        kind: 'PAID_JOB',
        title: 'Unsafe job',
        summary: null,
        tags: [],
        reward: { type: 'CASH_BOUNTY', amountMinor: 100, currency: 'USD' },
        compensation: { provided: false, text: null },
        engagement: null,
        readingTimeMinutes: null,
        originalUrl: 'http://example.com/job',
        attribution: 'Example',
        publishedAt: null,
        fetchedAt: serverTime,
      }],
      nextCursor: null,
      savedItems: [],
      recommendations: [],
      sources: [unavailableRemotive],
    })))

    await expect(getDiscoverPage()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiClientError>)
  })

  it('rejects malformed source freshness metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      sources: [{
        ...unavailableRemotive,
        status: 'FRESH',
        fetchedAt: null,
      }],
    })))

    await expect(getDiscoverSources()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiClientError>)
  })

  it('validates saved snapshots and sends protected idempotent mutations', async () => {
    document.cookie = 'aisidequest_csrf=test-csrf; path=/'
    const savedItemId = '00000000-0000-4000-8000-000000000027'
    const savedItem = {
      id: savedItemId,
      savedAt: serverTime,
      item: {
        id: 'REMOTIVE:job_123',
        source: 'REMOTIVE',
        category: 'EARNING',
        kind: 'PAID_JOB',
        title: 'Remote TypeScript Engineer',
        summary: null,
        tags: ['typescript'],
        reward: null,
        compensation: { provided: false, text: null },
        engagement: null,
        readingTimeMinutes: null,
        originalUrl: 'https://remotive.com/remote-jobs/software-dev/example',
        attribution: 'Remotive',
        publishedAt: '2026-07-19T08:00:00.000Z',
        fetchedAt: serverTime,
      },
    }
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ created: true, savedItem })
      if (init?.method === 'DELETE') return response({ deleted: true, savedItemId })
      return response({ items: [savedItem], nextCursor: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect((await getSavedDiscoverItems()).data.items[0]).toEqual(savedItem)
    expect((await saveDiscoverItem(savedItem.item.id)).data.created).toBe(true)
    expect((await deleteSavedDiscoverItem(savedItemId)).data.deleted).toBe(true)

    const mutationCalls = fetchMock.mock.calls.filter(([, init]) => init?.method)
    expect(mutationCalls).toHaveLength(2)
    for (const [, init] of mutationCalls) {
      expect(init?.headers).toMatchObject({ 'x-csrf-token': 'test-csrf' })
      expect(init?.headers).toHaveProperty('Idempotency-Key')
    }
  })

  it('reads and replaces only explicit interest tags with protected idempotent mutation', async () => {
    document.cookie = 'aisidequest_csrf=interest-csrf; path=/'
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => (
      response({
        tags: init?.method === 'PUT' ? ['typescript', 'react'] : ['typescript'],
        updatedAt: serverTime,
      })
    ))
    vi.stubGlobal('fetch', fetchMock)

    expect((await getDiscoverInterests()).data.tags).toEqual(['typescript'])
    expect((await updateDiscoverInterests(['typescript', 'react'])).data.tags).toEqual([
      'typescript',
      'react',
    ])

    const updateCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(updateCall?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ tags: ['typescript', 'react'] }),
    })
    expect(updateCall?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-csrf-token': 'interest-csrf',
    })
    expect(updateCall?.[1]?.headers).toHaveProperty('Idempotency-Key')
  })

  it('sends analytics without an item identifier or URL', async () => {
    document.cookie = 'aisidequest_csrf=analytics-csrf; path=/'
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => response({ recorded: true }))
    vi.stubGlobal('fetch', fetchMock)

    await recordDiscoverAnalyticsEvent({
      eventName: 'OUTBOUND_CLICK',
      source: 'REMOTIVE',
      category: 'EARNING',
    })
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.body).toBe(JSON.stringify({
      eventName: 'OUTBOUND_CLICK',
      source: 'REMOTIVE',
      category: 'EARNING',
    }))
    expect(String(init?.body)).not.toMatch(/item|url|title|tag/i)
    expect(init?.headers).toMatchObject({
      'x-csrf-token': 'analytics-csrf',
      'Content-Type': 'application/json',
    })
    expect(init?.headers).toHaveProperty('Idempotency-Key')
  })
})
