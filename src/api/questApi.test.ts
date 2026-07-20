import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from './apiClient'
import { getAllQuests, getQuest } from './questApi'

const quest = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'typescript-type-narrowing',
  version: 1,
  title: 'TypeScript 타입 좁히기',
  description: '타입 좁히기 퀴즈',
  estimatedMinutes: 2,
  rewardPoints: 100,
  passScore: 100,
  retryAllowed: true,
  completionStatus: 'NOT_STARTED',
  latestAttempt: null,
}

function response(data: unknown) {
  return new Response(JSON.stringify({
    data,
    meta: { serverTime: '2026-07-18T00:00:00.000Z' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('quest API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads every cursor page and preserves the explicit quest contract', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      return url.searchParams.has('cursor')
        ? response({ items: [{ ...quest, id: '00000000-0000-4000-8000-000000000002', code: 'http-idempotency' }], nextCursor: null })
        : response({ items: [quest], nextCursor: 'next-page' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getAllQuests()
    expect(result.data.map((item) => item.code)).toEqual([
      'typescript-type-narrowing',
      'http-idempotency',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed attempt metadata instead of trusting the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      ...quest,
      completionStatus: 'PASSED',
      latestAttempt: {
        id: 'attempt',
        status: 'COMPLETED',
        score: 101,
        passed: true,
        startedAt: 'invalid',
        completedAt: null,
      },
    })))

    await expect(getQuest(quest.code)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiClientError>)
  })
})
