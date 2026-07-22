import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DiscoverFetchError,
  DiscoverHttpClient,
} from '../../src/discover/discover-http-client'

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

test('permits only HTTPS URLs on the adapter allowlist', async () => {
  let calls = 0
  const client = new DiscoverHttpClient({
    fetch: (async () => { calls += 1; return jsonResponse({ ok: true }) }) as typeof fetch,
  })

  for (const url of [
    'http://api.example.com/items',
    'https://evil.example/items',
    'https://user:secret@api.example.com/items',
    'https://api.example.com:444/items',
  ]) {
    await assert.rejects(
      client.getJson({ url, allowedHosts: ['api.example.com'] }),
      (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_REQUEST',
    )
  }
  assert.equal(calls, 0)
})

test('sends an explicitly validated versioned Accept header', async () => {
  let receivedAccept: string | null = null
  const client = new DiscoverHttpClient({
    fetch: (async (_url: URL, init?: RequestInit) => {
      receivedAccept = new Headers(init?.headers).get('accept')
      return jsonResponse({ ok: true })
    }) as typeof fetch,
  })

  await client.getJson({
    url: 'https://api.example.com/items',
    allowedHosts: ['api.example.com'],
    accept: 'application/vnd.forem.api-v1+json',
  })
  assert.equal(receivedAccept, 'application/vnd.forem.api-v1+json')

  await assert.rejects(
    client.getJson({
      url: 'https://api.example.com/items',
      allowedHosts: ['api.example.com'],
      accept: 'application/json\r\nx-secret: value',
    }),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_REQUEST',
  )
})

test('sends validated server headers and exposes rate-limit response metadata', async () => {
  let receivedHeaders = new Headers()
  const client = new DiscoverHttpClient({
    fetch: (async (_url: URL, init?: RequestInit) => {
      receivedHeaders = new Headers(init?.headers)
      return jsonResponse({ items: [] }, {
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-resource': 'search',
          'x-ratelimit-remaining': '29',
        },
      })
    }) as typeof fetch,
  })

  const response = await client.getJsonResponse({
    url: 'https://api.example.com/items',
    allowedHosts: ['api.example.com'],
    headers: {
      authorization: 'Bearer server-only-token',
      'x-github-api-version': '2026-03-10',
    },
  })
  assert.equal(receivedHeaders.get('authorization'), 'Bearer server-only-token')
  assert.equal(receivedHeaders.get('x-github-api-version'), '2026-03-10')
  assert.equal(response.headers.get('x-ratelimit-resource'), 'search')

  await assert.rejects(
    client.getJson({
      url: 'https://api.example.com/items',
      allowedHosts: ['api.example.com'],
      headers: { authorization: 'Bearer token\r\nx-leak: true' },
    }),
    (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_REQUEST',
  )
})

test('classifies configured 403 and 429 responses as rate limited with retry timing', async () => {
  const now = Date.now()
  const responses = [
    jsonResponse({}, { status: 403, headers: { 'retry-after': '60' } }),
    jsonResponse({}, {
      status: 429,
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.ceil((now + 120_000) / 1_000)),
      },
    }),
    jsonResponse({}, { status: 403 }),
  ]
  const client = new DiscoverHttpClient({
    fetch: (async () => responses.shift() as Response) as typeof fetch,
  })

  for (const status of [403, 429, 403]) {
    await assert.rejects(
      client.getJson({
        url: 'https://api.example.com/items',
        allowedHosts: ['api.example.com'],
        rateLimitStatusCodes: [403, 429],
        maxAttempts: 1,
      }),
      (error) => error instanceof DiscoverFetchError
        && error.reason === 'RATE_LIMITED'
        && error.retryAt !== null
        && error.retryAt > now,
      `status ${status}`,
    )
  }
})

test('rejects redirects, non-JSON and oversized response bodies', async () => {
  const responses = [
    new Response(null, { status: 302, headers: { location: 'https://api.example.com/next' } }),
    new Response('text', { status: 200, headers: { 'content-type': 'text/plain' } }),
    jsonResponse({ large: 'x'.repeat(100) }),
  ]
  const client = new DiscoverHttpClient({
    fetch: (async () => responses.shift() as Response) as typeof fetch,
  })

  for (const maxResponseBytes of [1_000, 1_000, 10]) {
    await assert.rejects(
      client.getJson({
        url: 'https://api.example.com/items',
        allowedHosts: ['api.example.com'],
        maxAttempts: 1,
        maxResponseBytes,
      }),
      (error) => error instanceof DiscoverFetchError && error.reason === 'INVALID_RESPONSE',
    )
  }
})

test('retries only a bounded number of transient failures', async () => {
  let calls = 0
  let sleeps = 0
  const client = new DiscoverHttpClient({
    fetch: (async () => {
      calls += 1
      if (calls === 1) return jsonResponse({}, { status: 503 })
      return jsonResponse({ ok: true })
    }) as typeof fetch,
    sleep: async () => { sleeps += 1 },
  })

  assert.deepEqual(await client.getJson({
    url: 'https://api.example.com/items',
    allowedHosts: ['api.example.com'],
    maxAttempts: 2,
  }), { ok: true })
  assert.equal(calls, 2)
  assert.equal(sleeps, 1)
})

test('does not retry a permanent upstream client error', async () => {
  let calls = 0
  const client = new DiscoverHttpClient({
    fetch: (async () => {
      calls += 1
      return jsonResponse({}, { status: 404 })
    }) as typeof fetch,
    sleep: async () => undefined,
  })

  await assert.rejects(client.getJson({
    url: 'https://api.example.com/items',
    allowedHosts: ['api.example.com'],
    maxAttempts: 3,
  }))
  assert.equal(calls, 1)
})

test('aborts a hung request at the configured timeout', async () => {
  const client = new DiscoverHttpClient({
    fetch: ((_url: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as typeof fetch,
  })

  await assert.rejects(
    client.getJson({
      url: 'https://api.example.com/items',
      allowedHosts: ['api.example.com'],
      timeoutMs: 10,
      maxAttempts: 1,
    }),
    (error) => error instanceof DiscoverFetchError && error.reason === 'TIMEOUT',
  )
})
