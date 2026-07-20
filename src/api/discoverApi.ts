import type {
  DiscoverCategory,
  DiscoverCompensation,
  DiscoverItem,
  DiscoverKind,
  DiscoverPage,
  DiscoverReward,
  DiscoverSource,
  DiscoverSourceList,
  DiscoverSourceSnapshot,
  DiscoverSourceStatus,
} from '../types/discover'
import { ApiClientError, requestApi } from './apiClient'

const SOURCES = new Set<DiscoverSource>([
  'HACKER_NEWS',
  'REMOTIVE',
  'DEV',
  'STACK_EXCHANGE',
  'GITHUB',
  'ALGORA',
])
const CATEGORIES = new Set<DiscoverCategory>(['EARNING', 'NEWS', 'COMMUNITY'])
const KINDS = new Set<DiscoverKind>([
  'PAID_JOB',
  'CASH_BOUNTY',
  'REPUTATION_BOUNTY',
  'OSS_TASK',
  'ARTICLE',
  'DISCUSSION',
])
const SOURCE_STATUSES = new Set<DiscoverSourceStatus>([
  'FRESH',
  'STALE',
  'UNAVAILABLE',
])
const ITEM_ID_PATTERN = /^(HACKER_NEWS|REMOTIVE|DEV|STACK_EXCHANGE|GITHUB|ALGORA):[A-Za-z0-9_-]{1,200}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !hasControlCharacter(value)
  } catch {
    return false
  }
}

function invalidDiscoverResponse(): never {
  throw new ApiClientError(
    0,
    'INVALID_API_RESPONSE',
    'Discover 응답 형식을 확인할 수 없습니다.',
  )
}

function parseReward(value: unknown): DiscoverReward | null {
  if (value === null) return null
  if (!isRecord(value)) return invalidDiscoverResponse()

  if (
    value.type === 'CASH_BOUNTY'
    && Number.isSafeInteger(value.amountMinor)
    && (value.amountMinor as number) > 0
    && typeof value.currency === 'string'
    && /^[A-Z]{3}$/.test(value.currency)
  ) {
    return {
      type: 'CASH_BOUNTY',
      amountMinor: value.amountMinor as number,
      currency: value.currency,
    }
  }

  if (
    value.type === 'REPUTATION_BOUNTY'
    && Number.isSafeInteger(value.amount)
    && (value.amount as number) > 0
  ) {
    return {
      type: 'REPUTATION_BOUNTY',
      amount: value.amount as number,
    }
  }

  return invalidDiscoverResponse()
}

function parseCompensation(value: unknown): DiscoverCompensation | null {
  if (value === null) return null
  if (!isRecord(value)) return invalidDiscoverResponse()

  if (value.provided === false && value.text === null) {
    return { provided: false, text: null }
  }
  if (value.provided === true && isNonEmptyString(value.text)) {
    return { provided: true, text: value.text }
  }
  return invalidDiscoverResponse()
}

function assertKindContract(item: DiscoverItem) {
  const categoryMatches =
    (item.category === 'EARNING'
      && (item.kind === 'PAID_JOB' || item.kind === 'CASH_BOUNTY'))
    || (item.category === 'NEWS' && item.kind === 'ARTICLE')
    || (item.category === 'COMMUNITY'
      && (
        item.kind === 'DISCUSSION'
        || item.kind === 'REPUTATION_BOUNTY'
        || item.kind === 'OSS_TASK'
      ))

  const rewardMatches =
    (item.kind === 'CASH_BOUNTY' && item.reward?.type === 'CASH_BOUNTY')
    || (
      item.kind === 'REPUTATION_BOUNTY'
      && item.reward?.type === 'REPUTATION_BOUNTY'
    )
    || (
      item.kind !== 'CASH_BOUNTY'
      && item.kind !== 'REPUTATION_BOUNTY'
      && item.reward === null
    )

  const compensationMatches = item.kind === 'PAID_JOB'
    ? item.compensation !== null
    : item.compensation === null

  if (!categoryMatches || !rewardMatches || !compensationMatches) {
    invalidDiscoverResponse()
  }
}

function parseItem(value: unknown): DiscoverItem {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !ITEM_ID_PATTERN.test(value.id)
    || typeof value.source !== 'string'
    || !SOURCES.has(value.source as DiscoverSource)
    || !value.id.startsWith(`${value.source}:`)
    || typeof value.category !== 'string'
    || !CATEGORIES.has(value.category as DiscoverCategory)
    || typeof value.kind !== 'string'
    || !KINDS.has(value.kind as DiscoverKind)
    || !isNonEmptyString(value.title)
    || !(value.summary === null || typeof value.summary === 'string')
    || !Array.isArray(value.tags)
    || !value.tags.every(isNonEmptyString)
    || !isHttpsUrl(value.originalUrl)
    || !isNonEmptyString(value.attribution)
    || !(value.publishedAt === null || isDate(value.publishedAt))
    || !isDate(value.fetchedAt)
  ) {
    return invalidDiscoverResponse()
  }

  const item: DiscoverItem = {
    id: value.id,
    source: value.source as DiscoverSource,
    category: value.category as DiscoverCategory,
    kind: value.kind as DiscoverKind,
    title: value.title,
    summary: value.summary,
    tags: value.tags,
    reward: parseReward(value.reward),
    compensation: parseCompensation(value.compensation),
    originalUrl: value.originalUrl,
    attribution: value.attribution,
    publishedAt: value.publishedAt,
    fetchedAt: value.fetchedAt,
  }
  assertKindContract(item)
  return item
}

function parseSource(value: unknown): DiscoverSourceSnapshot {
  if (
    !isRecord(value)
    || typeof value.source !== 'string'
    || !SOURCES.has(value.source as DiscoverSource)
    || !isNonEmptyString(value.displayName)
    || !Array.isArray(value.categories)
    || value.categories.length === 0
    || !value.categories.every(
      (category) => typeof category === 'string'
        && CATEGORIES.has(category as DiscoverCategory),
    )
    || new Set(value.categories).size !== value.categories.length
    || typeof value.enabled !== 'boolean'
    || typeof value.status !== 'string'
    || !SOURCE_STATUSES.has(value.status as DiscoverSourceStatus)
    || !(value.fetchedAt === null || isDate(value.fetchedAt))
    || (
      (value.status === 'FRESH' || value.status === 'STALE')
      && value.fetchedAt === null
    )
  ) {
    return invalidDiscoverResponse()
  }

  return {
    source: value.source as DiscoverSource,
    displayName: value.displayName,
    categories: value.categories as DiscoverCategory[],
    enabled: value.enabled,
    status: value.status as DiscoverSourceStatus,
    fetchedAt: value.fetchedAt,
  }
}

function parseSources(value: unknown) {
  if (!Array.isArray(value)) return invalidDiscoverResponse()
  const sources = value.map(parseSource)
  if (new Set(sources.map((source) => source.source)).size !== sources.length) {
    invalidDiscoverResponse()
  }
  return sources
}

function parsePage(value: unknown): DiscoverPage {
  if (
    !isRecord(value)
    || !Array.isArray(value.items)
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')
    || !Array.isArray(value.sources)
  ) {
    return invalidDiscoverResponse()
  }
  const items = value.items.map(parseItem)
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    invalidDiscoverResponse()
  }
  return {
    items,
    nextCursor: value.nextCursor,
    sources: parseSources(value.sources),
  }
}

function parseSourceList(value: unknown): DiscoverSourceList {
  if (!isRecord(value) || !Array.isArray(value.sources)) {
    return invalidDiscoverResponse()
  }
  return { sources: parseSources(value.sources) }
}

export interface DiscoverQuery {
  category?: DiscoverCategory
  source?: DiscoverSource
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

export function getDiscoverPage(options: DiscoverQuery = {}) {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) })
  if (options.category) query.set('category', options.category)
  if (options.source) query.set('source', options.source)
  if (options.cursor) query.set('cursor', options.cursor)
  return requestApi(`/discover?${query}`, parsePage, { signal: options.signal })
}

export function getDiscoverSources(signal?: AbortSignal) {
  return requestApi('/discover/sources', parseSourceList, { signal })
}
