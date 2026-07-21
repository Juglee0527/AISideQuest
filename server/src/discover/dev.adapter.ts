import { Injectable } from '@nestjs/common'

import type { DiscoverSourceAdapter } from './discover-adapter'
import { DiscoverFetchError, DiscoverHttpClient } from './discover-http-client'
import { extractDiscoverInterestTags, toDiscoverPlainText } from './discover-normalization'
import type { DiscoverItem } from './discover.types'

const DEV_API_URL = 'https://dev.to/api/articles?per_page=30'
const DEV_FETCH_HOSTS = ['dev.to'] as const
const DEV_V1_ACCEPT = 'application/vnd.forem.api-v1+json'
const DEV_ATTRIBUTION = 'DEV Community'
const DEV_ARTICLE_LIMIT = 30
const MAX_INVALID_ARTICLE_RATIO = 0.25

@Injectable()
export class DevAdapter implements DiscoverSourceAdapter {
  readonly source = 'DEV' as const
  readonly displayName = DEV_ATTRIBUTION
  readonly categories = ['NEWS'] as const
  readonly cachePolicy = {
    freshForMs: 30 * 60_000,
    maxStaleMs: 24 * 60 * 60_000,
  }

  constructor(private readonly httpClient: DiscoverHttpClient) {}

  async fetchItems(): Promise<DiscoverItem[]> {
    const response = await this.httpClient.getJson({
      url: DEV_API_URL,
      allowedHosts: DEV_FETCH_HOSTS,
      accept: DEV_V1_ACCEPT,
      timeoutMs: 5_000,
      maxAttempts: 1,
      maxResponseBytes: 1_000_000,
    })
    if (!Array.isArray(response)) {
      throw new DiscoverFetchError('INVALID_RESPONSE')
    }

    const articles = response.slice(0, DEV_ARTICLE_LIMIT)
    const fetchedAt = new Date().toISOString()
    const seenIds = new Set<number>()
    const items: DiscoverItem[] = []
    let invalidArticles = 0

    for (const article of articles) {
      const item = parseArticle(article, fetchedAt)
      if (!item) {
        invalidArticles += 1
        continue
      }

      const id = Number(item.id.slice('DEV:'.length))
      if (seenIds.has(id)) continue
      seenIds.add(id)
      items.push(item)
    }

    if (
      articles.length > 0
      && (
        items.length === 0
        || (
          invalidArticles >= 3
          && invalidArticles / articles.length > MAX_INVALID_ARTICLE_RATIO
        )
      )
    ) {
      throw new DiscoverFetchError('INVALID_RESPONSE')
    }

    return items
  }
}

function parseArticle(value: unknown, fetchedAt: string): DiscoverItem | null {
  if (!isRecord(value) || value.type_of !== 'article') return null
  if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0) return null

  const id = value.id as number
  const title = toDiscoverPlainText(value.title, 300)
  const summary = toDiscoverPlainText(value.description, 1_000) || null
  const originalUrl = toDevUrl(value.url)
  const publishedAt = toPublishedAt(value.published_timestamp ?? value.published_at)
  if (!title || !originalUrl || !publishedAt) return null

  const sourceTags = parseTags(value.tag_list ?? value.tags)
  return {
    id: `DEV:${id}`,
    source: 'DEV',
    category: 'NEWS',
    kind: 'ARTICLE',
    title,
    summary,
    tags: [...new Set([
      'dev-community',
      ...sourceTags,
      ...extractDiscoverInterestTags(title, summary, ...sourceTags),
    ])].slice(0, 20),
    reward: null,
    compensation: null,
    engagement: toReactions(value.positive_reactions_count),
    readingTimeMinutes: toReadingTime(value.reading_time_minutes),
    originalUrl,
    attribution: DEV_ATTRIBUTION,
    publishedAt,
    fetchedAt,
  }
}

function parseTags(value: unknown) {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  return [...new Set(candidates
    .map((tag) => toDiscoverPlainText(tag, 50).toLowerCase())
    .filter(Boolean))]
    .slice(0, 15)
}

function toReactions(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000
    ? { type: 'REACTIONS' as const, value: value as number }
    : null
}

function toReadingTime(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1_440
    ? value as number
    : null
}

function toDevUrl(value: unknown) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.username !== ''
      || url.password !== ''
      || url.hostname.toLowerCase() !== 'dev.to'
      || url.port !== ''
      || url.href.length > 2_000
    ) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

function toPublishedAt(value: unknown) {
  if (
    typeof value !== 'string'
    || value.length > 50
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
  ) {
    return null
  }
  const milliseconds = Date.parse(value.trim())
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
