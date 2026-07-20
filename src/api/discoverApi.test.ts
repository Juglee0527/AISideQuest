import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from './apiClient'
import { getDiscoverPage, getDiscoverSources } from './discoverApi'

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
          originalUrl: 'https://console.algora.io/bounties/example',
          attribution: 'Algora',
          publishedAt: null,
          fetchedAt: serverTime,
        },
      ],
      nextCursor: null,
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
        originalUrl: 'http://example.com/job',
        attribution: 'Example',
        publishedAt: null,
        fetchedAt: serverTime,
      }],
      nextCursor: null,
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
})
