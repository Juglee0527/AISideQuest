import { Inject, Injectable } from '@nestjs/common'

import { OperationalLoggerService } from '../observability/operational-logger.service'
import { OperationalMetricsService } from '../observability/operational-metrics.service'
import { validationError } from '../sessions/session-input'
import {
  DISCOVER_SOURCE_ADAPTERS,
  type DiscoverSourceAdapter,
} from './discover-adapter'
import { DiscoverCacheService, type DiscoverCacheEntry } from './discover-cache.service'
import type { DiscoverListQueryDto } from './discover.dto'
import { DiscoverFetchError, type DiscoverFetchFailure } from './discover-http-client'
import {
  DISCOVER_SOURCES,
  type DiscoverCategory,
  type DiscoverCursor,
  type DiscoverItem,
  type DiscoverListResult,
  type DiscoverSource,
  type DiscoverSourceListResult,
  type DiscoverSourceSnapshot,
} from './discover.types'

const DISCOVER_ITEM_ID_PATTERN = /^(HACKER_NEWS|REMOTIVE|DEV|STACK_EXCHANGE|GITHUB|ALGORA):[A-Za-z0-9_-]{1,200}$/

const SOURCE_CATALOG: readonly DiscoverSourceSnapshot[] = [
  { source: 'HACKER_NEWS', displayName: 'Hacker News', categories: ['EARNING', 'NEWS', 'COMMUNITY'], enabled: false, status: 'UNAVAILABLE', fetchedAt: null },
  { source: 'REMOTIVE', displayName: 'Remotive', categories: ['EARNING'], enabled: false, status: 'UNAVAILABLE', fetchedAt: null },
  { source: 'DEV', displayName: 'DEV Community', categories: ['NEWS'], enabled: false, status: 'UNAVAILABLE', fetchedAt: null },
  { source: 'STACK_EXCHANGE', displayName: 'Stack Overflow', categories: ['COMMUNITY'], enabled: false, status: 'UNAVAILABLE', fetchedAt: null },
  { source: 'GITHUB', displayName: 'GitHub', categories: ['COMMUNITY'], enabled: false, status: 'UNAVAILABLE', fetchedAt: null },
  { source: 'ALGORA', displayName: 'Algora', categories: ['EARNING'], enabled: false, status: 'UNAVAILABLE', fetchedAt: null },
]

interface LoadedSource {
  snapshot: DiscoverSourceSnapshot
  items: DiscoverItem[]
}

@Injectable()
export class DiscoverService {
  private readonly adapters = new Map<DiscoverSource, DiscoverSourceAdapter>()
  private readonly inFlightRefreshes = new Map<DiscoverSource, Promise<LoadedSource>>()

  constructor(
    @Inject(DISCOVER_SOURCE_ADAPTERS)
    adapters: readonly DiscoverSourceAdapter[],
    private readonly cacheService: DiscoverCacheService,
    private readonly metrics: OperationalMetricsService,
    private readonly logger: OperationalLoggerService,
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.source)) {
        throw new Error(`Duplicate Discover adapter: ${adapter.source}`)
      }
      this.adapters.set(adapter.source, adapter)
    }
  }

  async listDiscover(
    _userId: string,
    query: DiscoverListQueryDto,
  ): Promise<DiscoverListResult> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null
    const selectedSources = this.filterCatalog(query.source, query.category)
    const loaded = await Promise.all(selectedSources.map((source) => this.loadSource(source)))
    const snapshots = loaded.map((result) => result.snapshot)

    const uniqueItems = new Map<string, DiscoverItem>()
    for (const item of loaded.flatMap((result) => result.items)) {
      if (query.category !== undefined && item.category !== query.category) continue
      if (query.source !== undefined && item.source !== query.source) continue
      if (!uniqueItems.has(item.id)) uniqueItems.set(item.id, item)
    }

    const sorted = [...uniqueItems.values()].sort(compareItems)
    const afterCursor = cursor
      ? sorted.filter((item) => compareItemToCursor(item, cursor) > 0)
      : sorted
    const items = afterCursor.slice(0, query.limit)
    const nextCursor = afterCursor.length > query.limit && items.length > 0
      ? this.encodeCursor(items.at(-1) as DiscoverItem)
      : null

    return { items, nextCursor, sources: snapshots }
  }

  async listSources(): Promise<DiscoverSourceListResult> {
    const sources = await Promise.all(SOURCE_CATALOG.map((source) => this.readSourceStatus(source)))
    return { sources }
  }

  private async loadSource(catalog: DiscoverSourceSnapshot): Promise<LoadedSource> {
    const adapter = this.adapters.get(catalog.source)
    if (!adapter) return this.disabledSource(catalog)

    const cached = await this.cacheService.read(adapter.source).catch(() => null)
    if (cached && this.ageMs(cached) < adapter.cachePolicy.freshForMs) {
      this.metrics.recordDiscoverCache(adapter.source, 'FRESH')
      return this.fromCache(adapter, cached, 'FRESH')
    }

    const existing = this.inFlightRefreshes.get(adapter.source)
    if (existing) return existing

    const refresh = this.refreshSource(adapter, cached)
      .finally(() => this.inFlightRefreshes.delete(adapter.source))
    this.inFlightRefreshes.set(adapter.source, refresh)
    return refresh
  }

  private async refreshSource(
    adapter: DiscoverSourceAdapter,
    cached: DiscoverCacheEntry | null,
  ): Promise<LoadedSource> {
    this.metrics.recordDiscoverCache(adapter.source, cached ? 'STALE' : 'MISS')
    this.metrics.recordDiscoverFetch(adapter.source, 'ATTEMPT')
    try {
      const result = await this.cacheService.refreshWithLock(
        adapter.source,
        adapter.cachePolicy.freshForMs,
        () => adapter.fetchItems(),
      )
      if (result.entry) {
        this.metrics.recordDiscoverFetch(adapter.source, 'SUCCESS')
        return this.fromCache(adapter, result.entry, 'FRESH')
      }

      this.metrics.recordDiscoverFetch(adapter.source, 'SKIPPED_LOCKED')
      const latest = await this.cacheService.read(adapter.source).catch(() => cached)
      return this.fallback(adapter, latest)
    } catch (error) {
      const reason = this.failureReason(error)
      this.metrics.recordDiscoverFetch(adapter.source, 'FAILURE', reason)
      this.logger.error({
        event: 'discover_source_refresh_failed',
        source: adapter.source,
        failureReason: reason,
      })
      return this.fallback(adapter, cached)
    }
  }

  private fallback(adapter: DiscoverSourceAdapter, cached: DiscoverCacheEntry | null) {
    if (cached && this.ageMs(cached) <= adapter.cachePolicy.maxStaleMs) {
      return this.fromCache(adapter, cached, 'STALE')
    }
    return {
      snapshot: this.adapterSnapshot(adapter, 'UNAVAILABLE', null),
      items: [],
    }
  }

  private async readSourceStatus(catalog: DiscoverSourceSnapshot) {
    const adapter = this.adapters.get(catalog.source)
    if (!adapter) return this.disabledSource(catalog).snapshot
    const cached = await this.cacheService.read(adapter.source).catch(() => null)
    if (!cached) return this.adapterSnapshot(adapter, 'UNAVAILABLE', null)
    const age = this.ageMs(cached)
    if (age < adapter.cachePolicy.freshForMs) {
      return this.adapterSnapshot(adapter, 'FRESH', cached.refreshedAt)
    }
    if (age <= adapter.cachePolicy.maxStaleMs) {
      return this.adapterSnapshot(adapter, 'STALE', cached.refreshedAt)
    }
    return this.adapterSnapshot(adapter, 'UNAVAILABLE', null)
  }

  private fromCache(
    adapter: DiscoverSourceAdapter,
    cached: DiscoverCacheEntry,
    status: 'FRESH' | 'STALE',
  ): LoadedSource {
    return {
      snapshot: this.adapterSnapshot(adapter, status, cached.refreshedAt),
      items: cached.items,
    }
  }

  private disabledSource(catalog: DiscoverSourceSnapshot): LoadedSource {
    return {
      snapshot: { ...catalog, categories: [...catalog.categories] },
      items: [],
    }
  }

  private adapterSnapshot(
    adapter: DiscoverSourceAdapter,
    status: DiscoverSourceSnapshot['status'],
    fetchedAt: string | null,
  ): DiscoverSourceSnapshot {
    return {
      source: adapter.source,
      displayName: adapter.displayName,
      categories: [...adapter.categories],
      enabled: true,
      status,
      fetchedAt,
    }
  }

  private filterCatalog(source?: DiscoverSource, category?: DiscoverCategory) {
    return SOURCE_CATALOG
      .filter((entry) => source === undefined || entry.source === source)
      .filter((entry) => category === undefined || entry.categories.includes(category))
  }

  private ageMs(entry: DiscoverCacheEntry) {
    return Math.max(0, Date.now() - Date.parse(entry.refreshedAt))
  }

  private failureReason(error: unknown): DiscoverFetchFailure {
    return error instanceof DiscoverFetchError ? error.reason : 'INVALID_RESPONSE'
  }

  private encodeCursor(item: DiscoverItem) {
    const cursor: DiscoverCursor = {
      version: 1,
      sortAt: item.publishedAt ?? item.fetchedAt,
      source: item.source,
      id: item.id,
    }
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(cursor: string): DiscoverCursor {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) validationError('cursor is invalid')

    let value: unknown
    try {
      value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
      validationError('cursor is invalid')
    }

    if (
      typeof value !== 'object' || value === null || Array.isArray(value)
      || !('version' in value) || value.version !== 1
      || !('sortAt' in value) || typeof value.sortAt !== 'string' || !Number.isFinite(Date.parse(value.sortAt))
      || !('source' in value) || typeof value.source !== 'string' || !DISCOVER_SOURCES.includes(value.source as DiscoverSource)
      || !('id' in value) || typeof value.id !== 'string' || !DISCOVER_ITEM_ID_PATTERN.test(value.id)
      || !value.id.startsWith(`${value.source}:`)
    ) {
      validationError('cursor is invalid')
    }

    return {
      version: 1,
      sortAt: new Date(value.sortAt).toISOString(),
      source: value.source as DiscoverSource,
      id: value.id,
    }
  }
}

function itemSortAt(item: DiscoverItem) {
  return item.publishedAt ?? item.fetchedAt
}

function compareKeys(
  left: { sortAt: string; source: DiscoverSource; id: string },
  right: { sortAt: string; source: DiscoverSource; id: string },
) {
  const byDate = Date.parse(right.sortAt) - Date.parse(left.sortAt)
  if (byDate !== 0) return byDate
  const bySource = left.source.localeCompare(right.source)
  return bySource !== 0 ? bySource : left.id.localeCompare(right.id)
}

function compareItems(left: DiscoverItem, right: DiscoverItem) {
  return compareKeys(
    { sortAt: itemSortAt(left), source: left.source, id: left.id },
    { sortAt: itemSortAt(right), source: right.source, id: right.id },
  )
}

function compareItemToCursor(item: DiscoverItem, cursor: DiscoverCursor) {
  return compareKeys(
    { sortAt: itemSortAt(item), source: item.source, id: item.id },
    cursor,
  )
}
