import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'

import type { AppEnvironment } from '../../src/config/environment'
import {
  DiscoverFetchError,
  type DiscoverHttpClient,
  type DiscoverJsonRequest,
  type DiscoverJsonResponse,
} from '../../src/discover/discover-http-client'
import { GithubIssuesAdapter } from '../../src/discover/github-issues.adapter'
import { GithubSearchRequestGate } from '../../src/discover/github-search-request-gate'
import { normalizeDiscoverItem } from '../../src/discover/discover-normalization'

class FakeHttpClient {
  readonly requests: DiscoverJsonRequest[] = []
  response: DiscoverJsonResponse = {
    body: { total_count: 0, incomplete_results: false, items: [] },
    headers: new Headers({
      'x-ratelimit-resource': 'search',
      'x-ratelimit-remaining': '29',
      'x-ratelimit-reset': '1784700060',
    }),
  }
  error: Error | null = null

  async getJsonResponse(request: DiscoverJsonRequest) {
    this.requests.push(request)
    if (this.error) throw this.error
    return this.response
  }
}

function createAdapter(overrides: Partial<AppEnvironment> = {}) {
  const client = new FakeHttpClient()
  const config = new ConfigService<AppEnvironment, true>({
    GITHUB_DISCOVER_TOKEN: 'github_pat_server_only_test_token',
    GITHUB_DISCOVER_ORGANIZATIONS: ['openai'],
    GITHUB_DISCOVER_REPOSITORIES: ['example/project'],
    ...overrides,
  } as AppEnvironment)
  return {
    adapter: new GithubIssuesAdapter(
      client as unknown as DiscoverHttpClient,
      new GithubSearchRequestGate({ now: () => Date.UTC(2026, 6, 22, 10) }),
      config,
    ),
    client,
  }
}

function issue(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    number: id,
    title: `TypeScript documentation issue ${id}`,
    html_url: `https://github.com/openai/example/issues/${id}`,
    state: 'open',
    assignee: null,
    assignees: [],
    labels: [{ name: 'documentation' }],
    created_at: '2026-07-20T10:00:00Z',
    ...overrides,
  }
}

test('uses one scoped authenticated issue-only search and normalizes OSS tasks', async () => {
  const { adapter, client } = createAdapter()
  client.response.body = {
    total_count: 1,
    incomplete_results: false,
    items: [issue(10, { title: 'TypeScript &amp; React docs', labels: [
      { name: 'good first issue' },
      { name: 'documentation' },
      { name: 'bounty' },
    ] })],
  }

  const items = await adapter.fetchItems()
  assert.equal(adapter.isConfigured(), true)
  assert.deepEqual(adapter.cachePolicy, {
    freshForMs: 30 * 60_000,
    maxStaleMs: 24 * 60 * 60_000,
  })
  assert.equal(items.length, 1)
  assert.doesNotThrow(() => normalizeDiscoverItem(items[0]!, 'GITHUB'))
  assert.deepEqual(items[0] && {
    kind: items[0].kind,
    title: items[0].title,
    summary: items[0].summary,
    reward: items[0].reward,
    tags: items[0].tags,
    originalUrl: items[0].originalUrl,
  }, {
    kind: 'OSS_TASK',
    title: 'TypeScript & React docs',
    summary: 'Open issue in openai/example',
    reward: null,
    tags: ['github', 'open-source', 'good first issue', 'documentation', 'bounty', 'typescript', 'react'],
    originalUrl: 'https://github.com/openai/example/issues/10',
  })

  assert.equal(client.requests.length, 1)
  const request = client.requests[0]!
  const url = new URL(request.url)
  const query = url.searchParams.get('q') ?? ''
  assert.match(query, /is:issue is:open no:assignee/)
  assert.match(query, /label:"good first issue","help wanted",documentation/)
  assert.match(query, /org:openai/)
  assert.match(query, /repo:example\/project/)
  assert.equal(url.searchParams.get('per_page'), '30')
  assert.equal(url.searchParams.get('page'), '1')
  assert.equal(request.headers?.authorization, 'Bearer github_pat_server_only_test_token')
  assert.equal(request.headers?.['x-github-api-version'], '2026-03-10')
  assert.deepEqual(request.rateLimitStatusCodes, [403, 429])
  assert.equal(request.maxAttempts, 1)
})

test('defensively excludes pull requests, assigned issues, wrong labels and unapproved scopes', async () => {
  const { adapter, client } = createAdapter()
  const validIssues = Array.from({ length: 12 }, (_value, index) => issue(20 + index))
  client.response.body = {
    total_count: 16,
    incomplete_results: false,
    items: [
      ...validIssues,
      issue(40, { pull_request: { url: 'https://api.github.com/pulls/40' } }),
      issue(41, { assignee: { login: 'assigned' }, assignees: [{ login: 'assigned' }] }),
      issue(42, { labels: [{ name: 'bug' }] }),
      issue(43, { html_url: 'https://github.com/unapproved/project/issues/43' }),
    ],
  }

  assert.deepEqual(
    (await adapter.fetchItems()).map((item) => item.id),
    validIssues.map((value) => `GITHUB:${value.id}`),
  )
})

test('accepts explicitly approved repositories and fails incomplete or broadly invalid results', async () => {
  const repository = createAdapter({
    GITHUB_DISCOVER_ORGANIZATIONS: [],
    GITHUB_DISCOVER_REPOSITORIES: ['example/project'],
  })
  repository.client.response.body = {
    total_count: 1,
    incomplete_results: false,
    items: [issue(30, { html_url: 'https://github.com/example/project/issues/30' })],
  }
  assert.deepEqual((await repository.adapter.fetchItems()).map((item) => item.id), ['GITHUB:30'])

  const incomplete = createAdapter()
  incomplete.client.response.body = { total_count: 1, incomplete_results: true, items: [issue(31)] }
  await assert.rejects(
    incomplete.adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )

  const invalid = createAdapter()
  invalid.client.response.body = {
    total_count: 3,
    incomplete_results: false,
    items: [issue(40, { state: 'closed' }), issue(41, { state: 'closed' }), issue(42, { state: 'closed' })],
  }
  await assert.rejects(
    invalid.adapter.fetchItems(),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
  )
})

test('keeps GitHub disabled without the separate token and scopes', () => {
  const { adapter } = createAdapter({
    GITHUB_DISCOVER_TOKEN: '',
    GITHUB_DISCOVER_ORGANIZATIONS: [],
    GITHUB_DISCOVER_REPOSITORIES: [],
  })
  assert.equal(adapter.isConfigured(), false)
})
