import { Inject, Injectable } from '@nestjs/common'

import { hashToken } from '../auth/auth-crypto'
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
import { DiscoverInterestService } from './discover-interest.service'
import {
  compareRankedItems,
  rankDiscoverItems,
  type RankedDiscoverItem,
} from './discover-personalization'
import { DiscoverSavedService } from './discover-saved.service'
import {
  DISCOVER_ITEM_ID_PATTERN,
  DISCOVER_SOURCES,
  type DiscoverCategory,
  type DiscoverCursor,
  type DiscoverItem,
  type DiscoverListResult,
  type DiscoverSource,
  type DiscoverSourceListResult,
  type DiscoverSourceSnapshot,
} from './discover.types'

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
    private readonly savedService: DiscoverSavedService,
    private readonly interestService: DiscoverInterestService,
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
    userId: string,
    query: DiscoverListQueryDto,
  ): Promise<DiscoverListResult> {
    const interests = await this.interestService.getInterests(userId)
    const personalized = interests.tags.length > 0
    const interestHash = hashToken(JSON.stringify(interests.tags))
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null
    if (
      cursor
      && (
        cursor.interestHash !== interestHash
        || cursor.personalized !== personalized
      )
    ) {
      validationError('cursor does not match current interests')
    }
    const selectedSources = this.filterCatalog(query.source, query.category)
    const loaded = await Promise.all(selectedSources.map((source) => this.loadSource(source)))
    const snapshots = loaded.map((result) => result.snapshot)

    const uniqueItems = new Map<string, DiscoverItem>()
    for (const item of loaded.flatMap((result) => result.items)) {
      if (query.category !== undefined && item.category !== query.category) continue
      if (query.source !== undefined && item.source !== query.source) continue
      if (!uniqueItems.has(item.id)) uniqueItems.set(item.id, item)
    }

    const sorted = rankDiscoverItems([...uniqueItems.values()], interests.tags)
    const afterCursor = cursor
      ? sorted.filter((item) => compareRankedItems(item, cursor, personalized) > 0)
      : sorted
    const rankedItems = afterCursor.slice(0, query.limit)
    const items = rankedItems.map((ranked) => ranked.item)
    const nextCursor = afterCursor.length > query.limit && rankedItems.length > 0
      ? this.encodeCursor(
        rankedItems.at(-1) as RankedDiscoverItem,
        interestHash,
        personalized,
      )
      : null
    const savedItems = await this.savedService.findSavedItemReferences(userId, items)
    const recommendations = personalized
      ? rankedItems.map((ranked) => ({
        itemId: ranked.item.id,
        reasons: ranked.reasons,
        matchedInterests: ranked.matchedInterests,
      }))
      : []

    return { items, nextCursor, sources: snapshots, savedItems, recommendations }
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

  private encodeCursor(
    ranked: RankedDiscoverItem,
    interestHash: string,
    personalized: boolean,
  ) {
    const cursor: DiscoverCursor = {
      version: 2,
      interestHash,
      personalized,
      interestMatches: ranked.interestMatches,
      recencyBand: ranked.recencyBand,
      engagementValue: ranked.engagementValue,
      clearValue: ranked.clearValue,
      sortAt: ranked.sortAt,
      source: ranked.item.source,
      id: ranked.item.id,
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
      || !('version' in value) || value.version !== 2
      || !('interestHash' in value) || typeof value.interestHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.interestHash)
      || !('personalized' in value) || typeof value.personalized !== 'boolean'
      || !('interestMatches' in value) || !isIntegerBetween(value.interestMatches, 0, 10)
      || !('recencyBand' in value) || !isIntegerBetween(value.recencyBand, 0, 3)
      || !('engagementValue' in value) || !isIntegerBetween(value.engagementValue, 0, 1_000_000_000)
      || !('clearValue' in value) || typeof value.clearValue !== 'boolean'
      || !('sortAt' in value) || typeof value.sortAt !== 'string' || !Number.isFinite(Date.parse(value.sortAt))
      || !('source' in value) || typeof value.source !== 'string' || !DISCOVER_SOURCES.includes(value.source as DiscoverSource)
      || !('id' in value) || typeof value.id !== 'string' || !DISCOVER_ITEM_ID_PATTERN.test(value.id)
      || !value.id.startsWith(`${value.source}:`)
    ) {
      validationError('cursor is invalid')
    }

    return {
      version: 2,
      interestHash: value.interestHash,
      personalized: value.personalized,
      interestMatches: value.interestMatches,
      recencyBand: value.recencyBand,
      engagementValue: value.engagementValue,
      clearValue: value.clearValue,
      sortAt: new Date(value.sortAt).toISOString(),
      source: value.source as DiscoverSource,
      id: value.id,
    }
  }
}

function isIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}
