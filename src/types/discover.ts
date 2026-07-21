export type DiscoverSource =
  | 'HACKER_NEWS'
  | 'REMOTIVE'
  | 'DEV'
  | 'STACK_EXCHANGE'
  | 'GITHUB'
  | 'ALGORA'

export type DiscoverCategory = 'EARNING' | 'NEWS' | 'COMMUNITY'

export type DiscoverKind =
  | 'PAID_JOB'
  | 'CASH_BOUNTY'
  | 'REPUTATION_BOUNTY'
  | 'OSS_TASK'
  | 'ARTICLE'
  | 'DISCUSSION'

export type DiscoverSourceStatus = 'FRESH' | 'STALE' | 'UNAVAILABLE'

export type DiscoverReward =
  | { type: 'CASH_BOUNTY'; amountMinor: number; currency: string }
  | { type: 'REPUTATION_BOUNTY'; amount: number }

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

export interface DiscoverPage {
  items: DiscoverItem[]
  nextCursor: string | null
  sources: DiscoverSourceSnapshot[]
  savedItems: DiscoverSavedItemReference[]
}

export interface DiscoverSourceList {
  sources: DiscoverSourceSnapshot[]
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

export interface DiscoverSavedItemPage {
  items: DiscoverSavedItem[]
  nextCursor: string | null
}
