import {
  ApiClientError,
  createMutationHeaders,
  requestApi,
  type ApiResult,
} from './apiClient'
import type {
  Session,
  SessionHistoryPage,
  SessionStatus,
} from '../types/session'

const ACTIVE_SESSION_STATUSES: readonly SessionStatus[] = [
  'RUNNING',
  'WAITING_FOR_USER',
]
const SESSION_STATUSES: readonly SessionStatus[] = [
  ...ACTIVE_SESSION_STATUSES,
  'COMPLETED',
  'FAILED',
  'ABANDONED',
]
const SESSION_ORIGINS = ['HOOK', 'MANUAL'] as const
const TIMING_QUALITIES = ['EXACT', 'DEGRADED'] as const
const TERMINAL_REASONS = [
  'HOOK_STOP',
  'MANUAL_COMPLETED',
  'RECOVERED_LATE_STOP',
  'MANUAL_FAILED',
  'MANUAL_CANCELLED',
  'HEARTBEAT_TIMEOUT',
  'MANUAL_TIMEOUT',
  'SUPERSEDED_BY_NEW_TURN',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOneOf<T extends string>(
  value: unknown,
  candidates: readonly T[],
): value is T {
  return typeof value === 'string' && candidates.includes(value as T)
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function invalidSessionResponse(): never {
  throw new ApiClientError(
    0,
    'INVALID_API_RESPONSE',
    '세션 응답 형식을 확인할 수 없습니다.',
  )
}

function parseSession(value: unknown): Session {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id === '' ||
    value.provider !== 'CODEX' ||
    !isOneOf(value.status, SESSION_STATUSES) ||
    !isOneOf(value.origin, SESSION_ORIGINS) ||
    typeof value.autoLinked !== 'boolean' ||
    !isIsoDateString(value.startedAt) ||
    !(value.endedAt === null || isIsoDateString(value.endedAt)) ||
    !isIsoDateString(value.lastActivityAt) ||
    typeof value.durationMs !== 'number' ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    !(value.terminalReason === null || isOneOf(value.terminalReason, TERMINAL_REASONS)) ||
    !isOneOf(value.timingQuality, TIMING_QUALITIES) ||
    typeof value.version !== 'number' ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  ) {
    return invalidSessionResponse()
  }

  return {
    id: value.id,
    provider: value.provider,
    status: value.status,
    origin: value.origin,
    autoLinked: value.autoLinked,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    lastActivityAt: value.lastActivityAt,
    durationMs: value.durationMs,
    terminalReason: value.terminalReason,
    timingQuality: value.timingQuality,
    version: value.version,
  }
}

function parseActiveSessions(value: unknown) {
  if (!Array.isArray(value)) {
    return invalidSessionResponse()
  }

  const sessions = value.map(parseSession)

  if (!sessions.every(isActiveSession)) {
    return invalidSessionResponse()
  }

  return sessions
}

function parseSessionHistoryPage(value: unknown): SessionHistoryPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !(value.nextCursor === null || typeof value.nextCursor === 'string')
  ) {
    return invalidSessionResponse()
  }

  return {
    items: value.items.map(parseSession),
    nextCursor: value.nextCursor,
  }
}

export function isActiveSession(session: Session | null): session is Session {
  return session !== null && ACTIVE_SESSION_STATUSES.includes(session.status)
}

export function getActiveSessions(signal?: AbortSignal) {
  return requestApi('/sessions/active', parseActiveSessions, { signal })
}

export function getSessionHistoryPage(
  cursor: string | null,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ limit: '100' })

  if (cursor !== null) {
    query.set('cursor', cursor)
  }

  return requestApi(
    `/sessions?${query.toString()}`,
    parseSessionHistoryPage,
    { signal },
  )
}

export async function getAllSessionHistory(
  signal?: AbortSignal,
): Promise<ApiResult<Session[]>> {
  const sessions: Session[] = []
  const visitedCursors = new Set<string>()
  let cursor: string | null = null
  let latestServerTime = new Date().toISOString()

  do {
    const page = await getSessionHistoryPage(cursor, signal)
    sessions.push(...page.data.items)
    cursor = page.data.nextCursor
    latestServerTime = page.serverTime

    if (cursor !== null && visitedCursors.has(cursor)) {
      throw new ApiClientError(
        0,
        'INVALID_API_RESPONSE',
        '세션 이력의 다음 페이지 정보를 확인할 수 없습니다.',
      )
    }

    if (cursor !== null) {
      visitedCursors.add(cursor)
    }
  } while (cursor !== null)

  return {
    data: sessions,
    serverTime: latestServerTime,
  }
}

export async function startManualSession() {
  const result = await requestApi(
    '/sessions/manual',
    (value) => {
      if (!isRecord(value) || typeof value.created !== 'boolean') {
        return invalidSessionResponse()
      }

      return {
        created: value.created,
        session: parseSession(value.session),
      }
    },
    {
      method: 'POST',
      headers: createMutationHeaders(),
    },
  )

  return result
}

export async function endManualSession(sessionId: string) {
  const result = await requestApi(
    `/sessions/${encodeURIComponent(sessionId)}/end`,
    (value) => {
      if (!isRecord(value)) {
        return invalidSessionResponse()
      }

      return { session: parseSession(value.session) }
    },
    {
      method: 'POST',
      headers: {
        ...createMutationHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ outcome: 'COMPLETED' }),
    },
  )

  return result
}
