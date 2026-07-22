import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AppEnvironment } from '../config/environment'
import type { DiscoverSourceAdapter } from './discover-adapter'
import { DiscoverFetchError, DiscoverHttpClient } from './discover-http-client'
import { extractDiscoverInterestTags, toDiscoverPlainText } from './discover-normalization'
import { GithubSearchRequestGate } from './github-search-request-gate'
import type { DiscoverItem } from './discover.types'

const GITHUB_API_HOSTS = ['api.github.com'] as const
const GITHUB_API_VERSION = '2026-03-10'
const GITHUB_ACCEPT = 'application/vnd.github+json'
const GITHUB_ATTRIBUTION = 'GitHub'
const GITHUB_ISSUE_LIMIT = 30
const TARGET_LABELS = new Set(['good first issue', 'help wanted', 'documentation'])
const MAX_INVALID_ISSUE_RATIO = 0.25

@Injectable()
export class GithubIssuesAdapter implements DiscoverSourceAdapter {
  readonly source = 'GITHUB' as const
  readonly displayName = GITHUB_ATTRIBUTION
  readonly categories = ['COMMUNITY'] as const
  readonly cachePolicy = {
    freshForMs: 30 * 60_000,
    maxStaleMs: 24 * 60 * 60_000,
  }

  private readonly token: string
  private readonly organizations: ReadonlySet<string>
  private readonly repositories: ReadonlySet<string>
  private readonly searchUrl: string | null

  constructor(
    private readonly httpClient: DiscoverHttpClient,
    private readonly requestGate: GithubSearchRequestGate,
    configService: ConfigService<AppEnvironment, true>,
  ) {
    this.token = configService.getOrThrow('GITHUB_DISCOVER_TOKEN')
    const organizations = configService.getOrThrow('GITHUB_DISCOVER_ORGANIZATIONS')
    const repositories = configService.getOrThrow('GITHUB_DISCOVER_REPOSITORIES')
    this.organizations = new Set(organizations)
    this.repositories = new Set(repositories)
    this.searchUrl = this.token ? buildSearchUrl(organizations, repositories) : null
  }

  isConfigured() {
    return this.searchUrl !== null
  }

  async fetchItems(): Promise<DiscoverItem[]> {
    if (!this.searchUrl) throw new DiscoverFetchError('INVALID_REQUEST')
    this.requestGate.reserve()

    try {
      const response = await this.httpClient.getJsonResponse({
        url: this.searchUrl,
        allowedHosts: GITHUB_API_HOSTS,
        accept: GITHUB_ACCEPT,
        headers: {
          authorization: `Bearer ${this.token}`,
          'x-github-api-version': GITHUB_API_VERSION,
        },
        rateLimitStatusCodes: [403, 429],
        timeoutMs: 5_000,
        maxAttempts: 1,
        maxResponseBytes: 1_000_000,
      })
      this.requestGate.recordResponse(response.headers)
      return parseSearchResponse(
        response.body,
        this.organizations,
        this.repositories,
        new Date().toISOString(),
      )
    } catch (error) {
      this.requestGate.recordFailure(error)
      throw error
    }
  }
}

function buildSearchUrl(organizations: readonly string[], repositories: readonly string[]) {
  const scopes = [
    ...organizations.map((organization) => `org:${organization}`),
    ...repositories.map((repository) => `repo:${repository}`),
  ]
  const query = [
    'is:issue',
    'is:open',
    'no:assignee',
    'label:"good first issue","help wanted",documentation',
    ...scopes,
  ].join(' ')
  const url = new URL('https://api.github.com/search/issues')
  url.searchParams.set('q', query)
  url.searchParams.set('sort', 'updated')
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', String(GITHUB_ISSUE_LIMIT))
  url.searchParams.set('page', '1')
  return url.toString()
}

function parseSearchResponse(
  value: unknown,
  organizations: ReadonlySet<string>,
  repositories: ReadonlySet<string>,
  fetchedAt: string,
) {
  if (
    !isRecord(value)
    || !Number.isSafeInteger(value.total_count)
    || (value.total_count as number) < 0
    || value.incomplete_results !== false
    || !Array.isArray(value.items)
    || value.items.length > GITHUB_ISSUE_LIMIT
  ) {
    throw new DiscoverFetchError('INVALID_RESPONSE')
  }

  const items: DiscoverItem[] = []
  const seenIds = new Set<number>()
  let invalidIssues = 0
  for (const issue of value.items) {
    const item = parseIssue(issue, organizations, repositories, fetchedAt)
    if (!item) {
      invalidIssues += 1
      continue
    }
    const id = Number(item.id.slice('GITHUB:'.length))
    if (seenIds.has(id)) continue
    seenIds.add(id)
    items.push(item)
  }

  if (
    (value.total_count as number) > 0
    && (
      items.length === 0
      || (invalidIssues >= 3 && invalidIssues / value.items.length > MAX_INVALID_ISSUE_RATIO)
    )
  ) {
    throw new DiscoverFetchError('INVALID_RESPONSE')
  }
  return items
}

function parseIssue(
  value: unknown,
  organizations: ReadonlySet<string>,
  repositories: ReadonlySet<string>,
  fetchedAt: string,
): DiscoverItem | null {
  if (
    !isRecord(value)
    || 'pull_request' in value
    || value.state !== 'open'
    || value.assignee !== null
    || !Array.isArray(value.assignees)
    || value.assignees.length !== 0
    || !Number.isSafeInteger(value.id)
    || (value.id as number) <= 0
    || !Number.isSafeInteger(value.number)
    || (value.number as number) <= 0
  ) {
    return null
  }

  const id = value.id as number
  const issueNumber = value.number as number
  const title = toDiscoverPlainText(value.title, 300)
  const location = parseIssueLocation(value.html_url, issueNumber)
  const publishedAt = parseDate(value.created_at)
  const labels = parseLabels(value.labels)
  if (
    !title
    || !location
    || !publishedAt
    || !labels.some((label) => TARGET_LABELS.has(label))
    || !isApprovedScope(location.owner, location.repository, organizations, repositories)
  ) {
    return null
  }

  return {
    id: `GITHUB:${id}`,
    source: 'GITHUB',
    category: 'COMMUNITY',
    kind: 'OSS_TASK',
    title,
    summary: `Open issue in ${location.owner}/${location.repository}`,
    tags: [...new Set([
      'github',
      'open-source',
      ...labels,
      ...extractDiscoverInterestTags(title, ...labels),
    ])].slice(0, 20),
    reward: null,
    compensation: null,
    engagement: null,
    readingTimeMinutes: null,
    originalUrl: location.url,
    attribution: GITHUB_ATTRIBUTION,
    publishedAt,
    fetchedAt,
  }
}

function parseLabels(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map((label) => isRecord(label) ? toDiscoverPlainText(label.name, 50).toLowerCase() : '')
    .filter(Boolean))]
    .slice(0, 15)
}

function parseIssueLocation(value: unknown, issueNumber: number) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null
  try {
    const url = new URL(value)
    const segments = url.pathname.split('/').filter(Boolean)
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'github.com'
      || url.username !== ''
      || url.password !== ''
      || url.port !== ''
      || segments.length !== 4
      || segments[2] !== 'issues'
      || segments[3] !== String(issueNumber)
      || url.search !== ''
      || url.hash !== ''
      || url.href.length > 2_000
    ) {
      return null
    }
    return {
      owner: (segments[0] as string).toLowerCase(),
      repository: (segments[1] as string).toLowerCase(),
      url: url.href,
    }
  } catch {
    return null
  }
}

function isApprovedScope(
  owner: string,
  repository: string,
  organizations: ReadonlySet<string>,
  repositories: ReadonlySet<string>,
) {
  return organizations.has(owner) || repositories.has(`${owner}/${repository}`)
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
