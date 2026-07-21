import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import type { EntityManager } from 'typeorm'

import { DatabaseService } from '../database/database.service'
import { normalizeDiscoverItem } from './discover-normalization'
import type { DiscoverItem, DiscoverSource } from './discover.types'

interface DiscoverCacheRow {
  source: DiscoverSource
  items: unknown
  refreshed_at: Date | string
}

export interface DiscoverCacheEntry {
  source: DiscoverSource
  items: DiscoverItem[]
  refreshedAt: string
}

export interface DiscoverRefreshResult {
  lockAcquired: boolean
  entry: DiscoverCacheEntry | null
}

const CACHE_RETENTION_DAYS = 7
const CACHE_PURGE_THRESHOLD = '6 days 23 hours'
const CACHE_PURGE_INTERVAL_MS = 30 * 60_000

@Injectable()
export class DiscoverCacheService implements OnModuleInit, OnModuleDestroy {
  private purgeTimer?: NodeJS.Timeout

  constructor(private readonly databaseService: DatabaseService) {}

  onModuleInit() {
    this.purgeExpiredSafely()
    this.purgeTimer = setInterval(() => {
      this.purgeExpiredSafely()
    }, CACHE_PURGE_INTERVAL_MS)
    this.purgeTimer.unref()
  }

  onModuleDestroy() {
    if (this.purgeTimer) clearInterval(this.purgeTimer)
  }

  async read(source: DiscoverSource) {
    const rows = await this.databaseService.query<DiscoverCacheRow[]>(`
      SELECT source, items, refreshed_at
      FROM discover_source_cache
      WHERE source = $1
        AND refreshed_at >= now() - interval '${CACHE_RETENTION_DAYS} days'
    `, [source])
    return this.toEntry(rows[0])
  }

  async refreshWithLock(
    source: DiscoverSource,
    freshForMs: number,
    fetchItems: () => Promise<DiscoverItem[]>,
  ): Promise<DiscoverRefreshResult> {
    return this.databaseService.transaction(async (manager) => {
      const [lock] = await manager.query(`
        SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired
      `, [`aisidequest:discover:${source}`]) as Array<{ acquired: boolean }>
      if (!lock?.acquired) return { lockAcquired: false, entry: null }

      const current = await this.readWithManager(manager, source)
      if (
        current
        && Date.now() - Date.parse(current.refreshedAt) < freshForMs
      ) {
        return { lockAcquired: true, entry: current }
      }

      const items = (await fetchItems()).map((item) => normalizeDiscoverItem(item, source))
      const refreshedAt = new Date().toISOString()
      await manager.query(`
        INSERT INTO discover_source_cache (source, items, refreshed_at, updated_at)
        VALUES ($1, $2::jsonb, $3, now())
        ON CONFLICT (source) DO UPDATE
        SET items = EXCLUDED.items,
            refreshed_at = EXCLUDED.refreshed_at,
            updated_at = now()
      `, [source, JSON.stringify(items), refreshedAt])
      await manager.query(this.purgeQuery())
      return {
        lockAcquired: true,
        entry: { source, items, refreshedAt },
      }
    })
  }

  private async readWithManager(manager: EntityManager, source: DiscoverSource) {
    const rows = await manager.query(`
      SELECT source, items, refreshed_at
      FROM discover_source_cache
      WHERE source = $1
        AND refreshed_at >= now() - interval '${CACHE_RETENTION_DAYS} days'
    `, [source]) as DiscoverCacheRow[]
    return this.toEntry(rows[0])
  }

  private toEntry(row: DiscoverCacheRow | undefined): DiscoverCacheEntry | null {
    if (!row || !Array.isArray(row.items)) return null
    try {
      return {
        source: row.source,
        items: row.items.map((item) => normalizeDiscoverItem(item as DiscoverItem, row.source)),
        refreshedAt: new Date(row.refreshed_at).toISOString(),
      }
    } catch {
      return null
    }
  }

  private purgeExpired() {
    return this.databaseService.query(this.purgeQuery())
  }

  private purgeExpiredSafely() {
    void Promise.resolve()
      .then(() => this.purgeExpired())
      .catch(() => undefined)
  }

  private purgeQuery() {
    return `
      DELETE FROM discover_source_cache
      WHERE refreshed_at < now() - interval '${CACHE_PURGE_THRESHOLD}'
    `
  }
}
