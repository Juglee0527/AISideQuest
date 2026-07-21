import { Injectable } from '@nestjs/common'

import type { DiscoverSourceAdapter } from './discover-adapter'
import { DiscoverFetchError, DiscoverHttpClient } from './discover-http-client'
import { extractDiscoverInterestTags, toDiscoverPlainText } from './discover-normalization'
import type { DiscoverItem } from './discover.types'

const HACKER_NEWS_API_ORIGIN = 'https://hacker-news.firebaseio.com'
const HACKER_NEWS_FETCH_HOSTS = ['hacker-news.firebaseio.com'] as const
const HACKER_NEWS_ATTRIBUTION = 'Hacker News'
const FEED_ITEM_LIMIT = 12
const ITEM_FETCH_CONCURRENCY = 8
const MAX_ITEM_FAILURE_RATIO = 0.25

const HACKER_NEWS_FEEDS = [
  { kind: 'TOP', path: 'topstories' },
  { kind: 'SHOW', path: 'showstories' },
  { kind: 'ASK', path: 'askstories' },
  { kind: 'JOBS', path: 'jobstories' },
] as const

type HackerNewsFeedKind = (typeof HACKER_NEWS_FEEDS)[number]['kind']

interface HackerNewsItemCandidate {
  id: number
  feed: HackerNewsFeedKind
}

interface ItemFetchOutcome {
  item: DiscoverItem | null
  error?: unknown
}

@Injectable()
export class HackerNewsAdapter implements DiscoverSourceAdapter {
  readonly source = 'HACKER_NEWS' as const
  readonly displayName = 'Hacker News'
  readonly categories = ['EARNING', 'NEWS', 'COMMUNITY'] as const
  readonly cachePolicy = {
    freshForMs: 10 * 60_000,
    maxStaleMs: 24 * 60 * 60_000,
  }

  constructor(private readonly httpClient: DiscoverHttpClient) {}

  async fetchItems(): Promise<DiscoverItem[]> {
    const feedResponses = await Promise.all(
      HACKER_NEWS_FEEDS.map(async (feed) => ({
        feed,
        response: await this.httpClient.getJson({
          url: `${HACKER_NEWS_API_ORIGIN}/v0/${feed.path}.json`,
          allowedHosts: HACKER_NEWS_FETCH_HOSTS,
          timeoutMs: 3_000,
          maxAttempts: 2,
          maxResponseBytes: 50_000,
        }),
      })),
    )

    const candidates = new Map<number, HackerNewsItemCandidate>()
    for (const { feed, response } of feedResponses) {
      for (const id of parseFeedIds(response).slice(0, FEED_ITEM_LIMIT)) {
        // Feeds are ordered from broadest to most specific, so later feeds win.
        candidates.set(id, { id, feed: feed.kind })
      }
    }

    const fetchedAt = new Date().toISOString()
    const outcomes = await mapWithConcurrency(
      [...candidates.values()],
      ITEM_FETCH_CONCURRENCY,
      async (candidate): Promise<ItemFetchOutcome> => {
        try {
          const response = await this.httpClient.getJson({
            url: `${HACKER_NEWS_API_ORIGIN}/v0/item/${candidate.id}.json`,
            allowedHosts: HACKER_NEWS_FETCH_HOSTS,
            timeoutMs: 2_000,
            maxAttempts: 1,
            maxResponseBytes: 100_000,
          })
          return { item: parseItem(response, candidate, fetchedAt) }
        } catch (error) {
          return { item: null, error }
        }
      },
    )

    const failures = outcomes.filter((outcome) => outcome.error !== undefined)
    if (
      outcomes.length > 0
      && failures.length / outcomes.length > MAX_ITEM_FAILURE_RATIO
    ) {
      const firstError = failures[0]?.error
      throw firstError instanceof DiscoverFetchError
        ? firstError
        : new DiscoverFetchError('INVALID_RESPONSE')
    }

    return outcomes.flatMap((outcome) => outcome.item ? [outcome.item] : [])
  }
}

function parseFeedIds(value: unknown) {
  if (
    !Array.isArray(value)
    || !value.every((id) => Number.isSafeInteger(id) && id > 0)
  ) {
    throw new DiscoverFetchError('INVALID_RESPONSE')
  }
  return value as number[]
}

function parseItem(
  value: unknown,
  candidate: HackerNewsItemCandidate,
  fetchedAt: string,
): DiscoverItem | null {
  if (!isRecord(value) || value.deleted === true || value.dead === true) return null
  if (value.id !== candidate.id || !Number.isSafeInteger(value.id) || value.id <= 0) return null

  const actualFeed = value.type === 'job' ? 'JOBS' : candidate.feed
  if (value.type !== 'story' && value.type !== 'job') return null
  if (actualFeed === 'JOBS' && value.type !== 'job') return null

  const title = toDiscoverPlainText(value.title, 300)
  const publishedAt = toPublishedAt(value.time)
  if (!title || !publishedAt) return null

  const classification = classifyFeed(actualFeed)
  const summary = toDiscoverPlainText(value.text, 1_000) || null
  return {
    id: `HACKER_NEWS:${candidate.id}`,
    source: 'HACKER_NEWS',
    category: classification.category,
    kind: classification.kind,
    title,
    summary,
    tags: [
      'hacker-news',
      classification.tag,
      ...extractDiscoverInterestTags(title, summary),
    ],
    reward: null,
    compensation: actualFeed === 'JOBS'
      ? { provided: false, text: null }
      : null,
    engagement: toEngagement(value.score),
    originalUrl: toDisplayUrl(value.url, candidate.id),
    attribution: HACKER_NEWS_ATTRIBUTION,
    publishedAt,
    fetchedAt,
  }
}

function toEngagement(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? { type: 'SCORE' as const, value: value as number }
    : null
}

function classifyFeed(feed: HackerNewsFeedKind) {
  switch (feed) {
    case 'JOBS':
      return { category: 'EARNING' as const, kind: 'PAID_JOB' as const, tag: 'jobs' }
    case 'ASK':
      return { category: 'COMMUNITY' as const, kind: 'DISCUSSION' as const, tag: 'ask-hn' }
    case 'SHOW':
      return { category: 'NEWS' as const, kind: 'ARTICLE' as const, tag: 'show-hn' }
    case 'TOP':
      return { category: 'NEWS' as const, kind: 'ARTICLE' as const, tag: 'top' }
  }
}

function toPublishedAt(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return null
  const milliseconds = (value as number) * 1_000
  if (!Number.isFinite(milliseconds) || milliseconds > 8_640_000_000_000_000) {
    return null
  }
  return new Date(milliseconds).toISOString()
}

function toDisplayUrl(value: unknown, id: number) {
  if (typeof value === 'string' && !/[\r\n]/.test(value)) {
    try {
      const url = new URL(value)
      if (
        url.protocol === 'https:'
        && url.username === ''
        && url.password === ''
        && url.href.length <= 2_000
      ) {
        return url.href
      }
    } catch {
      // Fall through to the canonical Hacker News discussion link.
    }
  }
  return `https://news.ycombinator.com/item?id=${id}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
) {
  const results: R[] = []
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await work(values[index] as T)
      }
    },
  )
  await Promise.all(workers)
  return results
}
