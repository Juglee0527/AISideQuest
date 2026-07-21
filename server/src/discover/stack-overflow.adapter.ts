import { Injectable } from '@nestjs/common'

import type { DiscoverSourceAdapter } from './discover-adapter'
import { DiscoverFetchError, DiscoverHttpClient } from './discover-http-client'
import { extractDiscoverInterestTags, toDiscoverPlainText } from './discover-normalization'
import { StackExchangeRequestGate } from './stack-exchange-request-gate'
import type { DiscoverItem } from './discover.types'

const STACK_EXCHANGE_API_HOSTS = ['api.stackexchange.com'] as const
const STACK_OVERFLOW_ATTRIBUTION = 'Stack Overflow'
const QUESTION_LIMIT = 30
const MAX_INVALID_QUESTION_RATIO = 0.25
const REQUESTS = [
  {
    key: 'questions/featured',
    url: 'https://api.stackexchange.com/2.3/questions/featured?page=1&pagesize=30&order=desc&sort=creation&site=stackoverflow',
    requireBounty: true,
  },
  {
    key: 'questions/unanswered',
    url: 'https://api.stackexchange.com/2.3/questions/unanswered?page=1&pagesize=30&order=desc&sort=creation&site=stackoverflow',
    requireBounty: false,
  },
] as const

@Injectable()
export class StackOverflowAdapter implements DiscoverSourceAdapter {
  readonly source = 'STACK_EXCHANGE' as const
  readonly displayName = STACK_OVERFLOW_ATTRIBUTION
  readonly categories = ['COMMUNITY'] as const
  readonly cachePolicy = {
    freshForMs: 15 * 60_000,
    maxStaleMs: 24 * 60 * 60_000,
  }

  constructor(
    private readonly httpClient: DiscoverHttpClient,
    private readonly requestGate: StackExchangeRequestGate,
  ) {}

  async fetchItems(): Promise<DiscoverItem[]> {
    this.requestGate.reserve(REQUESTS.map((request) => request.key))

    const fetchedAt = new Date().toISOString()
    const items: DiscoverItem[] = []
    const seenIds = new Set<number>()

    for (const request of REQUESTS) {
      if (this.requestGate.isQuotaExhausted()) break

      const response = await this.httpClient.getJson({
        url: request.url,
        allowedHosts: STACK_EXCHANGE_API_HOSTS,
        timeoutMs: 5_000,
        maxAttempts: 1,
        maxResponseBytes: 1_000_000,
      })
      const wrapper = parseWrapper(response)
      this.requestGate.recordResponse(request.key, wrapper.backoffSeconds, wrapper.quotaRemaining)
      if (this.requestGate.isQuotaExhausted()) {
        throw new DiscoverFetchError('RATE_LIMITED')
      }

      const page = parseQuestions(wrapper.items, request.requireBounty, fetchedAt)
      for (const item of page) {
        const id = Number(item.id.slice('STACK_EXCHANGE:'.length))
        if (seenIds.has(id)) continue
        seenIds.add(id)
        items.push(item)
      }
    }

    return items
  }
}

function parseWrapper(value: unknown) {
  if (
    !isRecord(value)
    || !Array.isArray(value.items)
    || typeof value.has_more !== 'boolean'
    || !Number.isSafeInteger(value.quota_remaining)
    || (value.quota_remaining as number) < 0
  ) {
    throw new DiscoverFetchError('INVALID_RESPONSE')
  }

  const backoffSeconds = value.backoff === undefined ? null : value.backoff
  if (
    backoffSeconds !== null
    && (!Number.isSafeInteger(backoffSeconds) || (backoffSeconds as number) <= 0)
  ) {
    throw new DiscoverFetchError('INVALID_RESPONSE')
  }

  return {
    items: value.items.slice(0, QUESTION_LIMIT),
    hasMore: value.has_more,
    quotaRemaining: value.quota_remaining as number,
    backoffSeconds: backoffSeconds as number | null,
  }
}

function parseQuestions(values: unknown[], requireBounty: boolean, fetchedAt: string) {
  const items: DiscoverItem[] = []
  let invalidQuestions = 0

  for (const value of values) {
    const item = parseQuestion(value, requireBounty, fetchedAt)
    if (item) items.push(item)
    else invalidQuestions += 1
  }

  if (
    values.length > 0
    && (
      items.length === 0
      || (
        invalidQuestions >= 3
        && invalidQuestions / values.length > MAX_INVALID_QUESTION_RATIO
      )
    )
  ) {
    throw new DiscoverFetchError('INVALID_RESPONSE')
  }

  return items
}

function parseQuestion(
  value: unknown,
  requireBounty: boolean,
  fetchedAt: string,
): DiscoverItem | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.question_id) || (value.question_id as number) <= 0) {
    return null
  }

  const questionId = value.question_id as number
  const title = toDiscoverPlainText(value.title, 300)
  const originalUrl = toStackOverflowUrl(value.link, questionId)
  const publishedAt = toPublishedAt(value.creation_date)
  const bountyAmount = toPositiveInteger(value.bounty_amount)
  if (!title || !originalUrl || !publishedAt || (requireBounty && bountyAmount === null)) {
    return null
  }

  const sourceTags = parseTags(value.tags)
  const hasBounty = bountyAmount !== null
  return {
    id: `STACK_EXCHANGE:${questionId}`,
    source: 'STACK_EXCHANGE',
    category: 'COMMUNITY',
    kind: hasBounty ? 'REPUTATION_BOUNTY' : 'DISCUSSION',
    title,
    summary: null,
    tags: [...new Set([
      'stack-overflow',
      ...sourceTags,
      ...extractDiscoverInterestTags(title, ...sourceTags),
    ])].slice(0, 20),
    reward: hasBounty
      ? { type: 'REPUTATION_BOUNTY', amount: bountyAmount }
      : null,
    compensation: null,
    engagement: toScore(value.score),
    readingTimeMinutes: null,
    originalUrl,
    attribution: STACK_OVERFLOW_ATTRIBUTION,
    publishedAt,
    fetchedAt,
  }
}

function parseTags(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map((tag) => toDiscoverPlainText(tag, 50).toLowerCase())
    .filter(Boolean))]
    .slice(0, 15)
}

function toScore(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000
    ? { type: 'SCORE' as const, value: value as number }
    : null
}

function toPositiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1_000_000_000
    ? value as number
    : null
}

function toPublishedAt(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return null
  const milliseconds = (value as number) * 1_000
  const date = new Date(milliseconds)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function toStackOverflowUrl(value: unknown, questionId: number) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.username !== ''
      || url.password !== ''
      || url.hostname.toLowerCase() !== 'stackoverflow.com'
      || url.port !== ''
      || (
        url.pathname !== `/questions/${questionId}`
        && !url.pathname.startsWith(`/questions/${questionId}/`)
      )
      || url.href.length > 2_000
    ) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
