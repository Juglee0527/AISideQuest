import { Injectable } from '@nestjs/common'

import { DatabaseService } from '../database/database.service'
import type { DiscoverFetchFailure } from '../discover/discover-http-client'
import type { DiscoverSource } from '../discover/discover.types'

interface HttpCounter {
  method: string
  route: string
  status: number
  count: number
}

type DiscoverCacheResult = 'FRESH' | 'STALE' | 'MISS'
type DiscoverFetchResult = 'ATTEMPT' | 'SUCCESS' | 'FAILURE' | 'SKIPPED_LOCKED'

interface DiscoverCounter {
  source: DiscoverSource
  result: string
  reason?: DiscoverFetchFailure
  count: number
}

function metricLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

@Injectable()
export class OperationalMetricsService {
  private readonly httpCounters = new Map<string, HttpCounter>()
  private authFailures = 0
  private rateLimited = 0
  private serverErrors = 0
  private readonly discoverCacheCounters = new Map<string, DiscoverCounter>()
  private readonly discoverFetchCounters = new Map<string, DiscoverCounter>()

  constructor(private readonly databaseService: DatabaseService) {}

  recordHttp(method: string, route: string, status: number) {
    const key = `${method}:${route}:${status}`
    const existing = this.httpCounters.get(key)
    this.httpCounters.set(key, {
      method,
      route,
      status,
      count: (existing?.count ?? 0) + 1,
    })

    if (status === 401 || status === 403) this.authFailures += 1
    if (status === 429) this.rateLimited += 1
    if (status >= 500) this.serverErrors += 1
  }

  recordDiscoverCache(source: DiscoverSource, result: DiscoverCacheResult) {
    this.incrementDiscoverCounter(this.discoverCacheCounters, source, result)
  }

  recordDiscoverFetch(
    source: DiscoverSource,
    result: DiscoverFetchResult,
    reason?: DiscoverFetchFailure,
  ) {
    this.incrementDiscoverCounter(this.discoverFetchCounters, source, result, reason)
  }

  async renderPrometheus() {
    const snapshot = await this.databaseService.getOperationalSnapshot()
    const lines = [
      '# HELP aisidequest_process_uptime_seconds API process uptime.',
      '# TYPE aisidequest_process_uptime_seconds gauge',
      `aisidequest_process_uptime_seconds ${Math.floor(process.uptime())}`,
      '# HELP aisidequest_http_requests_total Completed HTTP requests.',
      '# TYPE aisidequest_http_requests_total counter',
      ...[...this.httpCounters.values()].map((counter) =>
        `aisidequest_http_requests_total{method="${metricLabel(counter.method)}",route="${metricLabel(counter.route)}",status="${counter.status}"} ${counter.count}`),
      `aisidequest_auth_failures_total ${this.authFailures}`,
      `aisidequest_rate_limited_total ${this.rateLimited}`,
      `aisidequest_http_5xx_total ${this.serverErrors}`,
      `aisidequest_active_sessions ${snapshot.activeSessions}`,
      `aisidequest_heartbeat_timeouts_15m ${snapshot.heartbeatTimeouts15m}`,
      `aisidequest_automatic_terminals_15m ${snapshot.automaticTerminals15m}`,
      `aisidequest_heartbeat_expiration_ratio ${snapshot.automaticTerminals15m === 0 ? 0 : snapshot.heartbeatTimeouts15m / snapshot.automaticTerminals15m}`,
      `aisidequest_late_stop_recoveries_15m ${snapshot.lateStopRecoveries15m}`,
      `aisidequest_deferred_events ${snapshot.deferredEvents}`,
      `aisidequest_deferred_event_oldest_age_seconds ${snapshot.deferredOldestAgeSeconds}`,
      `aisidequest_stale_devices ${snapshot.staleDevices}`,
      `aisidequest_plugin_queue_depth ${snapshot.pluginQueueDepth}`,
      `aisidequest_plugin_queue_oldest_age_seconds ${snapshot.pluginQueueOldestAgeSeconds}`,
      `aisidequest_plugin_dead_letters ${snapshot.pluginDeadLetters}`,
      `aisidequest_db_pool_total ${snapshot.databasePool.total}`,
      `aisidequest_db_pool_idle ${snapshot.databasePool.idle}`,
      `aisidequest_db_pool_waiting ${snapshot.databasePool.waiting}`,
      '# HELP aisidequest_discover_cache_total Discover cache resolution results.',
      '# TYPE aisidequest_discover_cache_total counter',
      ...[...this.discoverCacheCounters.values()].map((counter) =>
        `aisidequest_discover_cache_total{source="${counter.source}",result="${counter.result}"} ${counter.count}`),
      '# HELP aisidequest_discover_source_fetch_total Discover source fetch outcomes.',
      '# TYPE aisidequest_discover_source_fetch_total counter',
      ...[...this.discoverFetchCounters.values()].map((counter) =>
        `aisidequest_discover_source_fetch_total{source="${counter.source}",result="${counter.result}",reason="${counter.reason ?? 'NONE'}"} ${counter.count}`),
      '',
    ]

    return lines.join('\n')
  }

  private incrementDiscoverCounter(
    counters: Map<string, DiscoverCounter>,
    source: DiscoverSource,
    result: string,
    reason?: DiscoverFetchFailure,
  ) {
    const key = `${source}:${result}:${reason ?? 'NONE'}`
    const existing = counters.get(key)
    counters.set(key, { source, result, reason, count: (existing?.count ?? 0) + 1 })
  }
}
