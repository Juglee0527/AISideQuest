import { ApiClientError, requestApi } from './apiClient'
import type {
  Quest,
  QuestAttemptStatus,
  QuestCompletionStatus,
} from '../types/quest'

const ATTEMPT_STATUSES = new Set<QuestAttemptStatus>([
  'IN_PROGRESS',
  'SUBMITTED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
])
const COMPLETION_STATUSES = new Set<QuestCompletionStatus>([
  'NOT_STARTED',
  'IN_PROGRESS',
  'PASSED',
  'FAILED',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function invalidQuestResponse(): never {
  throw new ApiClientError(
    0,
    'INVALID_API_RESPONSE',
    '퀘스트 응답 형식을 확인할 수 없습니다.',
  )
}

function parseAttempt(value: unknown): Quest['latestAttempt'] {
  if (value === null) return null
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.status !== 'string'
    || !ATTEMPT_STATUSES.has(value.status as QuestAttemptStatus)
    || !(
      value.score === null
      || (
        typeof value.score === 'number'
        && Number.isInteger(value.score)
        && value.score >= 0
        && value.score <= 100
      )
    )
    || !(value.passed === null || typeof value.passed === 'boolean')
    || !isIsoDate(value.startedAt)
    || !(value.completedAt === null || isIsoDate(value.completedAt))
  ) {
    return invalidQuestResponse()
  }

  return {
    id: value.id,
    status: value.status as QuestAttemptStatus,
    score: value.score as number | null,
    passed: value.passed,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
  }
}

function parseQuest(value: unknown): Quest {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.code !== 'string'
    || typeof value.version !== 'number'
    || !Number.isInteger(value.version)
    || typeof value.title !== 'string'
    || typeof value.description !== 'string'
    || typeof value.estimatedMinutes !== 'number'
    || !Number.isInteger(value.estimatedMinutes)
    || typeof value.rewardPoints !== 'number'
    || !Number.isInteger(value.rewardPoints)
    || typeof value.passScore !== 'number'
    || !Number.isInteger(value.passScore)
    || typeof value.retryAllowed !== 'boolean'
    || typeof value.completionStatus !== 'string'
    || !COMPLETION_STATUSES.has(value.completionStatus as QuestCompletionStatus)
    || !('latestAttempt' in value)
  ) {
    return invalidQuestResponse()
  }

  return {
    id: value.id,
    code: value.code,
    version: value.version,
    title: value.title,
    description: value.description,
    estimatedMinutes: value.estimatedMinutes,
    rewardPoints: value.rewardPoints,
    passScore: value.passScore,
    retryAllowed: value.retryAllowed,
    completionStatus: value.completionStatus as QuestCompletionStatus,
    latestAttempt: parseAttempt(value.latestAttempt),
  }
}

function parseQuestPage(value: unknown) {
  if (
    !isRecord(value)
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')
  ) {
    return invalidQuestResponse()
  }

  return {
    items: value.items.map(parseQuest),
    nextCursor: value.nextCursor,
  }
}

export function getQuestPage(cursor?: string, signal?: AbortSignal) {
  const search = new URLSearchParams({ limit: '50' })
  if (cursor) search.set('cursor', cursor)
  return requestApi(`/quests?${search}`, parseQuestPage, { signal })
}

export async function getAllQuests(signal?: AbortSignal) {
  const quests: Quest[] = []
  let cursor: string | undefined
  let serverTime = new Date().toISOString()

  do {
    const result = await getQuestPage(cursor, signal)
    quests.push(...result.data.items)
    cursor = result.data.nextCursor ?? undefined
    serverTime = result.serverTime
  } while (cursor)

  return { data: quests, serverTime }
}

export function getQuest(code: string, signal?: AbortSignal) {
  return requestApi(`/quests/${encodeURIComponent(code)}`, parseQuest, { signal })
}
