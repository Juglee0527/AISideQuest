import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from './apiClient'
import {
  getActiveSessions,
  getAllSessionHistory,
  startManualSession,
} from './sessionApi'
import type { Session } from '../types/session'

const serverTime = '2026-07-16T00:00:00.000Z'

function createSession(id: string): Session {
  return {
    id,
    provider: 'CODEX',
    status: 'COMPLETED',
    origin: 'MANUAL',
    autoLinked: false,
    startedAt: '2026-07-15T23:59:00.000Z',
    endedAt: serverTime,
    lastActivityAt: serverTime,
    durationMs: 60_000,
    terminalReason: 'MANUAL_COMPLETED',
    timingQuality: 'EXACT',
    workspaceLabel: 'AISideQuest',
    operationLabel: 'npm test',
    version: 2,
  }
}

function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      ...(status >= 400 ? { error: data } : { data }),
      meta: { serverTime },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('session API client', () => {
  beforeEach(() => {
    document.cookie = 'aisidequest_csrf=csrf-token; path=/'
  })

  it('loads every cursor page without dropping session history', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const cursor = url.searchParams.get('cursor')

      return cursor === null
        ? response({ items: [createSession('session-1')], nextCursor: 'next-page' })
        : response({ items: [createSession('session-2')], nextCursor: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getAllSessionHistory()

    expect(result.data.map((session) => session.id)).toEqual([
      'session-1',
      'session-2',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends credentials, CSRF and a UUID idempotency key on manual start', async () => {
    const session = { ...createSession('session-1'), status: 'RUNNING', endedAt: null, terminalReason: null }
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => response({ created: true, session }))
    vi.stubGlobal('fetch', fetchMock)

    await startManualSession()

    const [url, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(url).toBe('http://localhost:3000/api/v1/sessions/manual')
    expect(init?.credentials).toBe('include')
    expect(init?.method).toBe('POST')
    expect(headers.get('x-csrf-token')).toBe('csrf-token')
    expect(headers.get('Idempotency-Key')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('preserves authentication errors from the API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      code: 'AUTH_REQUIRED',
      message: '로그인이 필요합니다.',
    }, 401)))

    const request = getActiveSessions()

    await expect(request).rejects.toBeInstanceOf(ApiClientError)
    await expect(request).rejects.toMatchObject({
        status: 401,
        code: 'AUTH_REQUIRED',
        message: '로그인이 필요합니다.',
    })
  })

  it('rejects a malformed success response instead of trusting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{ id: 'incomplete' }])))

    const request = getActiveSessions()

    await expect(request).rejects.toBeInstanceOf(ApiClientError)
    await expect(request).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it('rejects raw paths and non-allowlisted operations from a session response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([{
      ...createSession('session-1'),
      workspaceLabel: 'C:\\private\\source',
      operationLabel: 'curl --token secret',
    }])))

    await expect(getActiveSessions()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    })
  })
})
