import { ApiClientError, createMutationHeaders, requestApi } from './apiClient'
import type { QuestAttempt, QuestAttemptStatus } from '../types/quest'

const STATUSES = new Set<QuestAttemptStatus>([
  'IN_PROGRESS',
  'SUBMITTED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDateOrNull(value: unknown): value is string | null {
  return value === null
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function invalid(): never {
  throw new ApiClientError(
    0,
    'INVALID_API_RESPONSE',
    '퀴즈 응시 응답 형식을 확인할 수 없습니다.',
  )
}

function parseAttempt(value: unknown): QuestAttempt {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.aiSessionId !== 'string'
    || typeof value.status !== 'string'
    || !STATUSES.has(value.status as QuestAttemptStatus)
    || typeof value.startedAt !== 'string'
    || !Number.isFinite(Date.parse(value.startedAt))
    || !isDateOrNull(value.submittedAt)
    || !isDateOrNull(value.completedAt)
    || !isDateOrNull(value.submissionDeadline)
    || typeof value.canSubmit !== 'boolean'
    || typeof value.canRetry !== 'boolean'
    || !isRecord(value.quest)
    || typeof value.quest.id !== 'string'
    || typeof value.quest.code !== 'string'
    || !Number.isInteger(value.quest.version)
    || typeof value.quest.title !== 'string'
    || !Number.isInteger(value.quest.passScore)
    || !Number.isInteger(value.quest.rewardPoints)
    || typeof value.quest.retryAllowed !== 'boolean'
    || !Array.isArray(value.questions)
  ) invalid()

  const questions = value.questions.map((question) => {
    if (
      !isRecord(question)
      || typeof question.id !== 'string'
      || !Number.isInteger(question.position)
      || typeof question.prompt !== 'string'
      || !(question.selectedOptionId === null || typeof question.selectedOptionId === 'string')
      || !Array.isArray(question.options)
    ) invalid()
    const options = question.options.map((option) => {
      if (
        !isRecord(option)
        || typeof option.id !== 'string'
        || !Number.isInteger(option.position)
        || typeof option.label !== 'string'
      ) invalid()
      return {
        id: option.id,
        position: option.position as number,
        label: option.label,
      }
    })
    return {
      id: question.id,
      position: question.position as number,
      prompt: question.prompt,
      selectedOptionId: question.selectedOptionId,
      options,
    }
  })

  let result: QuestAttempt['result'] = null
  if (value.result !== null) {
    if (
      !isRecord(value.result)
      || !Number.isInteger(value.result.score)
      || typeof value.result.passed !== 'boolean'
      || typeof value.result.retryAllowed !== 'boolean'
      || value.result.answerReview !== null
    ) invalid()
    result = {
      score: value.result.score as number,
      passed: value.result.passed,
      retryAllowed: value.result.retryAllowed,
      answerReview: null,
    }
  }

  return {
    id: value.id,
    aiSessionId: value.aiSessionId,
    status: value.status as QuestAttemptStatus,
    startedAt: value.startedAt,
    submittedAt: value.submittedAt,
    completedAt: value.completedAt,
    submissionDeadline: value.submissionDeadline,
    canSubmit: value.canSubmit,
    canRetry: value.canRetry,
    quest: {
      id: value.quest.id,
      code: value.quest.code,
      version: value.quest.version as number,
      title: value.quest.title,
      passScore: value.quest.passScore as number,
      rewardPoints: value.quest.rewardPoints as number,
      retryAllowed: value.quest.retryAllowed,
    },
    questions,
    result,
  }
}

function parseStarted(value: unknown) {
  if (!isRecord(value) || typeof value.created !== 'boolean' || !('attempt' in value)) {
    return invalid()
  }
  return { created: value.created, attempt: parseAttempt(value.attempt) }
}

function parseSubmitted(value: unknown) {
  if (!isRecord(value) || !('attempt' in value)) return invalid()
  return { attempt: parseAttempt(value.attempt) }
}

export function startQuestAttempt(code: string, idempotencyKey = crypto.randomUUID()) {
  return requestApi(`/quests/${encodeURIComponent(code)}/attempts`, parseStarted, {
    method: 'POST',
    headers: {
      ...createMutationHeaders(idempotencyKey),
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
}

export function getQuestAttempt(attemptId: string, signal?: AbortSignal) {
  return requestApi(`/quest-attempts/${encodeURIComponent(attemptId)}`, parseAttempt, { signal })
}

export function replaceQuestAnswers(
  attemptId: string,
  answers: Array<{ questionId: string; selectedOptionId: string }>,
) {
  return requestApi(`/quest-attempts/${encodeURIComponent(attemptId)}/answers`, parseAttempt, {
    method: 'PUT',
    headers: {
      ...createMutationHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ answers }),
  })
}

export function submitQuestAttempt(
  attemptId: string,
  idempotencyKey = crypto.randomUUID(),
) {
  return requestApi(
    `/quest-attempts/${encodeURIComponent(attemptId)}/submissions`,
    parseSubmitted,
    {
      method: 'POST',
      headers: {
        ...createMutationHeaders(idempotencyKey),
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
  )
}
