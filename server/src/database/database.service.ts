import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource, type EntityManager } from 'typeorm'

import type { AppEnvironment } from '../config/environment'
import { createDataSourceOptions } from './data-source'

export interface OperationalDatabaseSnapshot {
  activeSessions: number
  heartbeatTimeouts15m: number
  automaticTerminals15m: number
  lateStopRecoveries15m: number
  deferredEvents: number
  deferredOldestAgeSeconds: number
  staleDevices: number
  pluginQueueDepth: number
  pluginQueueOldestAgeSeconds: number
  pluginDeadLetters: number
  databasePool: { total: number; idle: number; waiting: number }
}

export interface DiscoverOperationalSnapshot {
  sources: Array<{
    source: string
    freshnessSeconds: number
    itemCount: number
  }>
  productEvents30d: Array<{
    eventName: string
    source: string
    category: string
    count: number
  }>
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private dataSource?: DataSource
  private initialization?: Promise<void>
  private lastInitializationFailureAt = 0

  constructor(
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  async onModuleInit() {
    await this.ensureInitialized().catch(() => undefined)
  }

  async onModuleDestroy() {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy()
    }
  }

  async query<T>(query: string, parameters: readonly unknown[] = []): Promise<T> {
    await this.ensureInitialized()
    return this.getDataSource().query(query, [...parameters]) as Promise<T>
  }

  async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    await this.ensureInitialized()
    return this.getDataSource().transaction(work)
  }

  async checkReadiness(timeoutMs = 2_000) {
    const check = async () => {
      await this.query('SELECT 1')
      return !(await this.getDataSource().showMigrations())
    }
    return Promise.race([
      check(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]).catch(() => false)
  }

  async getOperationalSnapshot(): Promise<OperationalDatabaseSnapshot> {
    const [row] = await this.query<Array<Record<string, number>>>(`
      SELECT
        (SELECT count(*)::integer FROM ai_sessions WHERE status IN ('RUNNING', 'WAITING_FOR_USER')) AS active_sessions,
        (SELECT count(*)::integer FROM ai_sessions WHERE terminal_reason = 'HEARTBEAT_TIMEOUT' AND ended_at >= now() - interval '15 minutes') AS heartbeat_timeouts_15m,
        (SELECT count(*)::integer FROM ai_sessions WHERE origin = 'HOOK' AND ended_at >= now() - interval '15 minutes') AS automatic_terminals_15m,
        (SELECT count(*)::integer FROM ai_sessions WHERE terminal_reason = 'RECOVERED_LATE_STOP' AND ended_at >= now() - interval '15 minutes') AS late_stop_recoveries_15m,
        (SELECT count(*)::integer FROM integration_events WHERE processing_result = 'DEFERRED') AS deferred_events,
        COALESCE((SELECT extract(epoch FROM now() - min(received_at))::integer FROM integration_events WHERE processing_result = 'DEFERRED'), 0) AS deferred_oldest_age_seconds,
        (SELECT count(*)::integer FROM devices WHERE revoked_at IS NULL AND expires_at > now() AND (last_seen_at IS NULL OR last_seen_at < now() - interval '2 minutes')) AS stale_devices,
        COALESCE((SELECT sum(queue_depth)::integer FROM devices WHERE diagnostics_reported_at >= now() - interval '5 minutes'), 0) AS plugin_queue_depth,
        COALESCE((SELECT max(queue_oldest_age_seconds)::integer FROM devices WHERE diagnostics_reported_at >= now() - interval '5 minutes'), 0) AS plugin_queue_oldest_age_seconds,
        COALESCE((SELECT sum(dead_letter_count)::integer FROM devices WHERE diagnostics_reported_at >= now() - interval '5 minutes'), 0) AS plugin_dead_letters
    `)
    return {
      activeSessions: row?.active_sessions ?? 0,
      heartbeatTimeouts15m: row?.heartbeat_timeouts_15m ?? 0,
      automaticTerminals15m: row?.automatic_terminals_15m ?? 0,
      lateStopRecoveries15m: row?.late_stop_recoveries_15m ?? 0,
      deferredEvents: row?.deferred_events ?? 0,
      deferredOldestAgeSeconds: row?.deferred_oldest_age_seconds ?? 0,
      staleDevices: row?.stale_devices ?? 0,
      pluginQueueDepth: row?.plugin_queue_depth ?? 0,
      pluginQueueOldestAgeSeconds: row?.plugin_queue_oldest_age_seconds ?? 0,
      pluginDeadLetters: row?.plugin_dead_letters ?? 0,
      databasePool: this.readPoolMetrics(),
    }
  }

  async getDiscoverOperationalSnapshot(): Promise<DiscoverOperationalSnapshot> {
    const sources = await this.query<Array<{
      source: string
      freshness_seconds: number
      item_count: number
    }>>(`
      SELECT source,
             greatest(0, extract(epoch FROM clock_timestamp() - refreshed_at))::double precision AS freshness_seconds,
             jsonb_array_length(items)::integer AS item_count
      FROM discover_source_cache
      ORDER BY source
    `)
    const productEvents30d = await this.query<Array<{
      event_name: string
      source: string
      category: string
      count: number
    }>>(`
      SELECT event_name,
             coalesce(source, 'NONE') AS source,
             coalesce(category, 'NONE') AS category,
             count(*)::integer AS count
      FROM discover_analytics_events
      WHERE occurred_at >= clock_timestamp() - interval '30 days'
        AND expires_at > clock_timestamp()
      GROUP BY event_name, source, category
      ORDER BY event_name, source, category
    `)
    return {
      sources: sources.map((row) => ({
        source: row.source,
        freshnessSeconds: row.freshness_seconds,
        itemCount: row.item_count,
      })),
      productEvents30d: productEvents30d.map((row) => ({
        eventName: row.event_name,
        source: row.source,
        category: row.category,
        count: row.count,
      })),
    }
  }

  private readPoolMetrics() {
    const driver = this.getDataSource().driver as unknown as {
      master?: { totalCount?: number; idleCount?: number; waitingCount?: number }
    }
    return {
      total: driver.master?.totalCount ?? 0,
      idle: driver.master?.idleCount ?? 0,
      waiting: driver.master?.waitingCount ?? 0,
    }
  }

  private getDataSource() {
    if (!this.dataSource?.isInitialized) {
      throw new Error('Database is not initialized')
    }

    return this.dataSource
  }

  private async ensureInitialized() {
    if (this.dataSource?.isInitialized) return
    if (this.initialization) return this.initialization
    if (Date.now() - this.lastInitializationFailureAt < 5_000) {
      throw new Error('Database is unavailable')
    }

    this.initialization = (async () => {
      const candidate = new DataSource(
        createDataSourceOptions({
          DATABASE_URL: this.configService.getOrThrow('DATABASE_URL'),
          DATABASE_SSL: this.configService.getOrThrow('DATABASE_SSL'),
        }),
      )
      try {
        await candidate.initialize()
        this.dataSource = candidate
      } catch (error) {
        this.lastInitializationFailureAt = Date.now()
        if (candidate.isInitialized) await candidate.destroy()
        throw error
      }
    })()

    try {
      await this.initialization
    } finally {
      this.initialization = undefined
    }
  }
}
