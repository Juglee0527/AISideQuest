import type {
  DiscoverCategory,
  DiscoverItem,
  DiscoverSource,
} from './discover.types'

export const DISCOVER_SOURCE_ADAPTERS = Symbol('DISCOVER_SOURCE_ADAPTERS')

export interface DiscoverCachePolicy {
  freshForMs: number
  maxStaleMs: number
}

export interface DiscoverSourceAdapter {
  readonly source: DiscoverSource
  readonly displayName: string
  readonly categories: readonly DiscoverCategory[]
  readonly cachePolicy: DiscoverCachePolicy
  fetchItems(): Promise<DiscoverItem[]>
}
