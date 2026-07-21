export const DISCOVER_SOURCES = [
  'HACKER_NEWS',
  'REMOTIVE',
  'DEV',
  'STACK_EXCHANGE',
  'GITHUB',
  'ALGORA',
] as const

export type DiscoverSource = (typeof DISCOVER_SOURCES)[number]

export const DISCOVER_CATEGORIES = [
  'EARNING',
  'NEWS',
  'COMMUNITY',
] as const

export type DiscoverCategory = (typeof DISCOVER_CATEGORIES)[number]

export const DISCOVER_KINDS = [
  'PAID_JOB',
  'CASH_BOUNTY',
  'REPUTATION_BOUNTY',
  'OSS_TASK',
  'ARTICLE',
  'DISCUSSION',
] as const

export type DiscoverKind = (typeof DISCOVER_KINDS)[number]

export const DISCOVER_SOURCE_STATUSES = [
  'FRESH',
  'STALE',
  'UNAVAILABLE',
] as const

export type DiscoverSourceStatus = (typeof DISCOVER_SOURCE_STATUSES)[number]

export const DISCOVER_ITEM_ID_PATTERN =
  /^(HACKER_NEWS|REMOTIVE|DEV|STACK_EXCHANGE|GITHUB|ALGORA):[A-Za-z0-9_-]{1,200}$/

export type DiscoverReward =
  | {
      type: 'CASH_BOUNTY'
      amountMinor: number
      currency: string
    }
  | {
      type: 'REPUTATION_BOUNTY'
      amount: number
    }

export type DiscoverCompensation =
  | { provided: false; text: null }
  | { provided: true; text: string }

export interface DiscoverItem {
  id: string
  source: DiscoverSource
  category: DiscoverCategory
  kind: DiscoverKind
  title: string
  summary: string | null
  tags: string[]
  reward: DiscoverReward | null
  compensation: DiscoverCompensation | null
  originalUrl: string
  attribution: string
  publishedAt: string | null
  fetchedAt: string
}

export interface DiscoverSourceSnapshot {
  source: DiscoverSource
  displayName: string
  categories: DiscoverCategory[]
  enabled: boolean
  status: DiscoverSourceStatus
  fetchedAt: string | null
}

export interface DiscoverListResult {
  items: DiscoverItem[]
  nextCursor: string | null
  sources: DiscoverSourceSnapshot[]
  savedItems: DiscoverSavedItemReference[]
}

export interface DiscoverSourceListResult {
  sources: DiscoverSourceSnapshot[]
}

export interface DiscoverCursor {
  version: 1
  sortAt: string
  source: DiscoverSource
  id: string
}

export interface DiscoverSavedItemReference {
  itemId: string
  savedItemId: string
}

export interface DiscoverSavedItem {
  id: string
  item: DiscoverItem
  savedAt: string
}

export interface DiscoverSavedItemListResult {
  items: DiscoverSavedItem[]
  nextCursor: string | null
}
