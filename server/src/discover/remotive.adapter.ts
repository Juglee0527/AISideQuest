import { Injectable } from '@nestjs/common'

import type { DiscoverSourceAdapter } from './discover-adapter'
import { DiscoverFetchError, DiscoverHttpClient } from './discover-http-client'
import { extractDiscoverInterestTags, toDiscoverPlainText } from './discover-normalization'
import type { DiscoverItem } from './discover.types'

const REMOTIVE_API_URL = 'https://remotive.com/api/remote-jobs?category=software-dev&limit=30'
const REMOTIVE_FETCH_HOSTS = ['remotive.com'] as const
const REMOTIVE_DISPLAY_HOSTS = new Set(['remotive.com', 'www.remotive.com'])
const REMOTIVE_JOB_LIMIT = 30
const REMOTIVE_ATTRIBUTION = 'Remotive'
const MAX_INVALID_JOB_RATIO = 0.25

const JOB_TYPE_TAGS: Record<string, string> = {
  contract: 'contract',
  freelance: 'freelance',
  full_time: 'full-time',
  'full-time': 'full-time',
  'full time': 'full-time',
  internship: 'internship',
  part_time: 'part-time',
  'part-time': 'part-time',
  'part time': 'part-time',
}

@Injectable()
export class RemotiveAdapter implements DiscoverSourceAdapter {
  readonly source = 'REMOTIVE' as const
  readonly displayName = 'Remotive'
  readonly categories = ['EARNING'] as const
  readonly cachePolicy = {
    freshForMs: 6 * 60 * 60_000,
    maxStaleMs: 72 * 60 * 60_000,
  }

  constructor(private readonly httpClient: DiscoverHttpClient) {}

  async fetchItems(): Promise<DiscoverItem[]> {
    const response = await this.httpClient.getJson({
      url: REMOTIVE_API_URL,
      allowedHosts: REMOTIVE_FETCH_HOSTS,
      timeoutMs: 5_000,
      maxAttempts: 1,
      maxResponseBytes: 1_000_000,
    })
    const jobs = parseJobs(response).slice(0, REMOTIVE_JOB_LIMIT)
    const fetchedAt = new Date().toISOString()
    const seenIds = new Set<number>()
    const items: DiscoverItem[] = []
    let invalidJobs = 0

    for (const job of jobs) {
      const item = parseJob(job, fetchedAt)
      if (!item) {
        invalidJobs += 1
        continue
      }
      const id = Number(item.id.slice('REMOTIVE:'.length))
      if (seenIds.has(id)) continue
      seenIds.add(id)
      items.push(item)
    }

    if (
      jobs.length > 0
      && (
        items.length === 0
        || (invalidJobs >= 3 && invalidJobs / jobs.length > MAX_INVALID_JOB_RATIO)
      )
    ) {
      throw new DiscoverFetchError('INVALID_RESPONSE')
    }
    return items
  }
}

function parseJobs(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.jobs)) {
    throw new DiscoverFetchError('INVALID_RESPONSE')
  }
  return value.jobs
}

function parseJob(value: unknown, fetchedAt: string): DiscoverItem | null {
  if (!isRecord(value)) return null
  if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0) return null
  if (toDiscoverPlainText(value.category, 100).toLowerCase() !== 'software development') {
    return null
  }

  const id = value.id as number
  const title = toDiscoverPlainText(value.title, 300)
  const originalUrl = toRemotiveUrl(value.url)
  const publishedAt = toPublishedAt(value.publication_date)
  if (!title || !originalUrl || !publishedAt) return null

  const salary = toDiscoverPlainText(value.salary, 300)
  const company = toDiscoverPlainText(value.company_name, 150)
  const location = toDiscoverPlainText(value.candidate_required_location, 150)
  const description = toDiscoverPlainText(value.description, 1_000)
  const context = [company, location].filter(Boolean).join(' · ')
  const summary = [context, description].filter(Boolean).join(' — ').slice(0, 1_000) || null
  const jobTypeTag = toJobTypeTag(value.job_type)

  return {
    id: `REMOTIVE:${id}`,
    source: 'REMOTIVE',
    category: 'EARNING',
    kind: 'PAID_JOB',
    title,
    summary,
    tags: [
      'remote',
      'software-development',
      ...(jobTypeTag ? [jobTypeTag] : []),
      ...extractDiscoverInterestTags(title, summary),
    ],
    reward: null,
    compensation: salary
      ? { provided: true, text: salary }
      : { provided: false, text: null },
    engagement: null,
    originalUrl,
    attribution: REMOTIVE_ATTRIBUTION,
    publishedAt,
    fetchedAt,
  }
}

function toJobTypeTag(value: unknown) {
  const normalized = toDiscoverPlainText(value, 50).toLowerCase()
  return JOB_TYPE_TAGS[normalized] ?? null
}

function toRemotiveUrl(value: unknown) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.username !== ''
      || url.password !== ''
      || !REMOTIVE_DISPLAY_HOSTS.has(url.hostname.toLowerCase())
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
  if (typeof value !== 'string' || value.length > 50) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.test(trimmed)) {
    return null
  }
  const withTimeZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)
    ? trimmed
    : `${trimmed}Z`
  const milliseconds = Date.parse(withTimeZone)
  if (!Number.isFinite(milliseconds)) return null
  return new Date(milliseconds).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
