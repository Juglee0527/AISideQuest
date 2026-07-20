import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from './apiClient'
import { getPointBalance, getPointLedger } from './pointApi'

function response(data: unknown) {
  return new Response(JSON.stringify({
    data,
    meta: { serverTime: '2026-07-18T00:00:00.000Z' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const entry = {
  id: '00000000-0000-4000-8000-000000000001',
  attemptId: '00000000-0000-4000-8000-000000000002',
  entryType: 'QUEST_REWARD',
  points: 100,
  description: 'First pass reward',
  createdAt: '2026-07-18T00:00:00.000Z',
  quest: {
    id: '00000000-0000-4000-8000-000000000003',
    code: 'typescript-type-narrowing',
    version: 1,
    title: 'TypeScript 타입 좁히기',
  },
}

describe('point API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses the balance and cursor ledger contracts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      return url.pathname.endsWith('/points/balance')
        ? response({ balance: 100 })
        : response({ items: [entry], nextCursor: 'next-page' })
    }))

    await expect(getPointBalance()).resolves.toMatchObject({ data: { balance: 100 } })
    await expect(getPointLedger({ limit: 1 })).resolves.toMatchObject({
      data: { items: [entry], nextCursor: 'next-page' },
    })
  })

  it('rejects unsafe balances and malformed ledger entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      return url.pathname.endsWith('/points/balance')
        ? response({ balance: Number.MAX_SAFE_INTEGER + 1 })
        : response({ items: [{ ...entry, points: '100' }], nextCursor: null })
    }))

    await expect(getPointBalance()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiClientError>)
    await expect(getPointLedger()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiClientError>)
  })
})
