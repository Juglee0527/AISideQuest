import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractDiscoverInterestTags } from '../../src/discover/discover-normalization'
import { rankDiscoverItems } from '../../src/discover/discover-personalization'
import type { DiscoverItem } from '../../src/discover/discover.types'

function item(
  id: string,
  publishedAt: string,
  tags: string[],
  engagementValue = 0,
  clearValue = false,
): DiscoverItem {
  return {
    id: `HACKER_NEWS:${id}`,
    source: 'HACKER_NEWS',
    category: clearValue ? 'EARNING' : 'NEWS',
    kind: clearValue ? 'PAID_JOB' : 'ARTICLE',
    title: id,
    summary: null,
    tags,
    reward: null,
    compensation: clearValue ? { provided: true, text: '$100k' } : null,
    engagement: engagementValue > 0
      ? { type: 'SCORE', value: engagementValue }
      : null,
    readingTimeMinutes: null,
    originalUrl: `https://example.com/${id}`,
    attribution: 'Example',
    publishedAt,
    fetchedAt: publishedAt,
  }
}

test('keeps the exact chronological default when no interests are selected', () => {
  const olderPopular = item('older', '2026-07-19T00:00:00.000Z', ['typescript'], 10_000)
  const newer = item('newer', '2026-07-20T00:00:00.000Z', [], 0)

  const ranked = rankDiscoverItems([olderPopular, newer], [])
  assert.deepEqual(ranked.map((entry) => entry.item.id), [newer.id, olderPopular.id])
})

test('ranks deterministically by explicit matches, recency band, engagement and clarity', () => {
  const values = [
    item('unmatched', '2026-07-21T00:00:00.000Z', [], 1_000),
    item('matched-low', '2026-07-20T12:00:00.000Z', ['typescript'], 1),
    item('matched-high', '2026-07-20T11:00:00.000Z', ['typescript'], 50),
    item('matched-clear', '2026-07-20T10:00:00.000Z', ['typescript'], 50, true),
  ]

  const first = rankDiscoverItems(values, ['typescript'])
  const second = rankDiscoverItems([...values].reverse(), ['typescript'])
  const expected = [
    'HACKER_NEWS:matched-clear',
    'HACKER_NEWS:matched-high',
    'HACKER_NEWS:matched-low',
    'HACKER_NEWS:unmatched',
  ]
  assert.deepEqual(first.map((entry) => entry.item.id), expected)
  assert.deepEqual(second.map((entry) => entry.item.id), expected)
  assert.deepEqual(first[0]?.matchedInterests, ['typescript'])
  assert.deepEqual(first[0]?.reasons, [
    'INTEREST_MATCH',
    'RECENT',
    'EXTERNAL_ENGAGEMENT',
    'CLEAR_VALUE',
  ])
})

test('extracts only fixed technology tags from normalized external text', () => {
  assert.deepEqual(
    extractDiscoverInterestTags('Senior TypeScript and React engineer', 'AWS security'),
    ['typescript', 'react', 'cloud', 'security'],
  )
  assert.deepEqual(extractDiscoverInterestTags('C# and C++ platform work'), ['csharp', 'cpp'])
  assert.deepEqual(extractDiscoverInterestTags('unrelated product role'), [])
})
