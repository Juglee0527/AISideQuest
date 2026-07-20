import type { PointLedgerEntry, PointLedgerPage } from '../types/point'
import { ApiClientError, requestApi } from './apiClient'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new ApiClientError(
    0,
    'INVALID_API_RESPONSE',
    '포인트 응답 형식을 확인할 수 없습니다.',
  )
}

function parseBalance(value: unknown) {
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.balance)
    || (value.balance as number) < 0
  ) invalid()
  return { balance: value.balance as number }
}

function parseEntry(value: unknown): PointLedgerEntry {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.attemptId !== 'string'
    || value.entryType !== 'QUEST_REWARD'
    || !Number.isInteger(value.points)
    || typeof value.description !== 'string'
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || !isRecord(value.quest)
    || typeof value.quest.id !== 'string'
    || typeof value.quest.code !== 'string'
    || !Number.isInteger(value.quest.version)
    || typeof value.quest.title !== 'string'
  ) invalid()

  return {
    id: value.id,
    attemptId: value.attemptId,
    entryType: 'QUEST_REWARD',
    points: value.points as number,
    description: value.description,
    createdAt: value.createdAt,
    quest: {
      id: value.quest.id,
      code: value.quest.code,
      version: value.quest.version as number,
      title: value.quest.title,
    },
  }
}

function parseLedgerPage(value: unknown): PointLedgerPage {
  if (
    !isRecord(value)
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')
  ) invalid()
  return {
    items: value.items.map(parseEntry),
    nextCursor: value.nextCursor,
  }
}

export function getPointBalance(signal?: AbortSignal) {
  return requestApi('/points/balance', parseBalance, { signal })
}

export function getPointLedger(
  options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
) {
  const parameters = new URLSearchParams({ limit: String(options.limit ?? 20) })
  if (options.cursor) parameters.set('cursor', options.cursor)
  return requestApi(`/points/ledger?${parameters}`, parseLedgerPage, {
    signal: options.signal,
  })
}
