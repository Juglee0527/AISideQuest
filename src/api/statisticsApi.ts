import type {
  StatisticsActivity,
  StatisticsPeriod,
  StatisticsSummary,
} from '../types/statistics'
import { ApiClientError, createMutationHeaders, requestApi } from './apiClient'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function safeInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function invalid(): never {
  throw new ApiClientError(0, 'INVALID_API_RESPONSE', '통계 응답 형식을 확인할 수 없습니다.')
}

function parseSummary(value: unknown): StatisticsSummary {
  if (
    !isRecord(value)
    || !['today', 'week', 'month', 'custom'].includes(String(value.period))
    || !isDate(value.asOf)
    || !isRecord(value.timeZone)
    || typeof value.timeZone.id !== 'string'
    || typeof value.timeZone.verified !== 'boolean'
    || !isRecord(value.range)
    || !isDate(value.range.startAt)
    || !isDate(value.range.endAt)
    || !isRecord(value.ai)
    || !safeInteger(value.ai.waitDurationMs)
    || !safeInteger(value.ai.sessionCount)
    || !safeInteger(value.ai.degradedSessionCount)
    || !isRecord(value.quests)
    || !safeInteger(value.quests.completedCount)
    || !isRecord(value.points)
    || !safeInteger(value.points.earned)
  ) invalid()
  return value as unknown as StatisticsSummary
}

function parseActivity(value: unknown): StatisticsActivity {
  if (!isRecord(value) || typeof value.id !== 'string' || !isDate(value.occurredAt)) invalid()
  if (value.type === 'AI_SESSION') {
    if (
      !safeInteger(value.durationMs)
      || typeof value.status !== 'string'
      || !['EXACT', 'DEGRADED'].includes(String(value.timingQuality))
    ) invalid()
    return value as unknown as StatisticsActivity
  }
  if (
    value.type !== 'QUEST_COMPLETED'
    || !safeInteger(value.points)
    || !isRecord(value.quest)
    || typeof value.quest.code !== 'string'
    || !Number.isInteger(value.quest.version)
    || typeof value.quest.title !== 'string'
  ) invalid()
  return value as unknown as StatisticsActivity
}

function parameters(options: {
  period: StatisticsPeriod
  start?: string
  end?: string
}) {
  const query = new URLSearchParams({ period: options.period })
  if (options.period === 'custom' && options.start && options.end) {
    query.set('start', options.start)
    query.set('end', options.end)
  }
  return query
}

export async function getStatisticsSummary(
  options: { period: StatisticsPeriod; start?: string; end?: string; signal?: AbortSignal },
) {
  const result = await requestApi(
    `/stats/summary?${parameters(options)}`,
    parseSummary,
    { signal: options.signal },
  )
  if (result.serverTime !== result.data.asOf) invalid()
  return result
}

export async function getStatisticsActivity(options: {
  period: StatisticsPeriod
  start?: string
  end?: string
  limit?: number
  cursor?: string
  signal?: AbortSignal
}) {
  const query = parameters(options)
  query.set('limit', String(options.limit ?? 20))
  if (options.cursor) query.set('cursor', options.cursor)
  const result = await requestApi(`/stats/activity?${query}`, (value) => {
    if (
      !isRecord(value)
      || !Array.isArray(value.items)
      || !(value.nextCursor === null || typeof value.nextCursor === 'string')
    ) invalid()
    const context = parseSummary({
      ...value,
      ai: { waitDurationMs: 0, sessionCount: 0, degradedSessionCount: 0 },
      quests: { completedCount: 0 },
      points: { earned: 0 },
    })
    return {
      period: context.period,
      asOf: context.asOf,
      timeZone: context.timeZone,
      range: context.range,
      items: value.items.map(parseActivity),
      nextCursor: value.nextCursor,
    }
  }, { signal: options.signal })
  if (result.serverTime !== result.data.asOf) invalid()
  return result
}

export function updateUserTimeZone(timeZone: string) {
  return requestApi('/auth/me/time-zone', (value) => {
    if (
      !isRecord(value)
      || typeof value.timeZone !== 'string'
      || value.timeZoneVerified !== true
    ) invalid()
    return { timeZone: value.timeZone, timeZoneVerified: true as const }
  }, {
    method: 'PATCH',
    headers: {
      ...createMutationHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ timeZone }),
  })
}
