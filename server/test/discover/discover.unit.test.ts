import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BadRequestException } from '@nestjs/common'

import { DiscoverService } from '../../src/discover/discover.service'

const userId = '00000000-0000-4000-8000-000000000001'

test('returns an explicit empty and unavailable baseline before adapters exist', () => {
  const service = new DiscoverService()
  const result = service.listDiscover(userId, { limit: 20 })

  assert.deepEqual(result.items, [])
  assert.equal(result.nextCursor, null)
  assert.equal(result.sources.length, 6)
  assert.ok(result.sources.every((source) => !source.enabled))
  assert.ok(result.sources.every((source) => source.status === 'UNAVAILABLE'))
  assert.ok(result.sources.every((source) => source.fetchedAt === null))
})

test('filters safe source metadata by source and category', () => {
  const service = new DiscoverService()

  const earning = service.listDiscover(userId, {
    category: 'EARNING',
    limit: 20,
  })
  assert.deepEqual(
    earning.sources.map((source) => source.source),
    ['HACKER_NEWS', 'REMOTIVE', 'ALGORA'],
  )

  const incompatible = service.listDiscover(userId, {
    category: 'COMMUNITY',
    source: 'REMOTIVE',
    limit: 20,
  })
  assert.deepEqual(incompatible.sources, [])
})

test('accepts only versioned stable Discover cursors', () => {
  const service = new DiscoverService()
  const validCursor = Buffer.from(JSON.stringify({
    version: 1,
    sortAt: '2026-07-20T08:00:00.000Z',
    source: 'REMOTIVE',
    id: 'REMOTIVE:job_123',
  }), 'utf8').toString('base64url')

  assert.doesNotThrow(() => service.listDiscover(userId, {
    cursor: validCursor,
    limit: 20,
  }))

  for (const cursor of [
    'invalid',
    Buffer.from(JSON.stringify({
      version: 2,
      sortAt: '2026-07-20T08:00:00.000Z',
      source: 'REMOTIVE',
      id: 'REMOTIVE:job_123',
    }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({
      version: 1,
      sortAt: 'not-a-date',
      source: 'REMOTIVE',
      id: 'HACKER_NEWS:123',
    }), 'utf8').toString('base64url'),
  ]) {
    assert.throws(
      () => service.listDiscover(userId, { cursor, limit: 20 }),
      (error) => error instanceof BadRequestException,
    )
  }
})

test('returns defensive source category copies', () => {
  const service = new DiscoverService()
  const first = service.listSources()
  first.sources[0]?.categories.push('NEWS')

  const second = service.listSources()
  assert.deepEqual(second.sources[0]?.categories, [
    'EARNING',
    'NEWS',
    'COMMUNITY',
  ])
})
