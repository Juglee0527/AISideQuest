import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from './apiClient'
import { getStatisticsActivity, getStatisticsSummary } from './statisticsApi'

const serverTime = '2026-07-18T06:00:00.000Z'
const summary = {
  period: 'today',
  asOf: serverTime,
  timeZone: { id: 'Asia/Seoul', verified: true },
  range: {
    startAt: '2026-07-17T15:00:00.000Z',
    endAt: '2026-07-18T15:00:00.000Z',
  },
  ai: { waitDurationMs: 3_600_000, sessionCount: 2, degradedSessionCount: 1 },
  quests: { completedCount: 1 },
  points: { earned: 100 },
}

function response(data: unknown, metaTime = serverTime) {
  return new Response(JSON.stringify({ data, meta: { serverTime: metaTime } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('statistics API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts a server-time anchored summary contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(summary)))
    await expect(getStatisticsSummary({ period: 'today' })).resolves.toMatchObject({
      data: summary,
      serverTime,
    })
  })

  it('rejects client-recomputed or malformed summary values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(summary, '2026-07-18T06:00:01.000Z')))
    await expect(getStatisticsSummary({ period: 'today' })).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiClientError>)

    vi.stubGlobal('fetch', vi.fn(async () => response({
      ...summary,
      ai: { ...summary.ai, waitDurationMs: Number.MAX_SAFE_INTEGER + 1 },
    })))
    await expect(getStatisticsSummary({ period: 'today' })).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiClientError>)
  })

  it('parses cursor-paginated mixed activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      period: 'today',
      asOf: serverTime,
      timeZone: summary.timeZone,
      range: summary.range,
      items: [{
        type: 'AI_SESSION',
        id: '00000000-0000-4000-8000-000000000001',
        occurredAt: '2026-07-18T05:00:00.000Z',
        durationMs: 60_000,
        status: 'COMPLETED',
        timingQuality: 'DEGRADED',
      }],
      nextCursor: 'next',
    })))
    const result = await getStatisticsActivity({ period: 'today', limit: 1 })
    expect(result.data.items[0]).toMatchObject({
      type: 'AI_SESSION',
      durationMs: 60_000,
      timingQuality: 'DEGRADED',
    })
    expect(result.data.nextCursor).toBe('next')
  })
})
