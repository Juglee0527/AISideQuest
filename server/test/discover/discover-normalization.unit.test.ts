import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  normalizeDiscoverItem,
  toDiscoverPlainText,
} from '../../src/discover/discover-normalization'
import type { DiscoverItem } from '../../src/discover/discover.types'

test('converts untrusted HTML into bounded plain text', () => {
  const text = toDiscoverPlainText(
    '<script>alert(1)</script><p>Hello&nbsp;<b>world</b></p>\u0000',
    100,
  )
  assert.equal(text, 'Hello world')
})

test('normalizes tags and display fields without changing reward meaning', () => {
  const value: DiscoverItem = {
    id: 'REMOTIVE:job_1',
    source: 'REMOTIVE',
    category: 'EARNING',
    kind: 'PAID_JOB',
    title: '<b>Senior Developer</b>',
    summary: '<p>Remote &amp; async</p>',
    tags: [' TypeScript ', 'typescript', '<i>Remote</i>'],
    reward: null,
    compensation: { provided: true, text: '<strong>$100k</strong>' },
    originalUrl: 'https://jobs.example.com/1',
    attribution: '<b>Example</b>',
    publishedAt: null,
    fetchedAt: '2026-07-20T08:00:00Z',
  }

  const normalized = normalizeDiscoverItem(value, 'REMOTIVE')
  assert.equal(normalized.title, 'Senior Developer')
  assert.equal(normalized.summary, 'Remote & async')
  assert.deepEqual(normalized.tags, ['typescript', 'remote'])
  assert.deepEqual(normalized.compensation, { provided: true, text: '$100k' })
})

test('rejects mixed source identities and unsafe display URLs', () => {
  const value = {
    id: 'HACKER_NEWS:1',
    source: 'HACKER_NEWS',
    category: 'NEWS',
    kind: 'ARTICLE',
    title: 'Title',
    summary: null,
    tags: [],
    reward: null,
    compensation: null,
    originalUrl: 'javascript:alert(1)',
    attribution: 'HN',
    publishedAt: null,
    fetchedAt: '2026-07-20T08:00:00Z',
  } as DiscoverItem

  assert.throws(() => normalizeDiscoverItem(value, 'REMOTIVE'))
  assert.throws(() => normalizeDiscoverItem(value, 'HACKER_NEWS'))

  assert.throws(() => normalizeDiscoverItem({
    ...value,
    originalUrl: 'https://example.com/1',
    reward: { type: 'UNKNOWN', amount: 1 } as never,
  }, 'HACKER_NEWS'))
})
