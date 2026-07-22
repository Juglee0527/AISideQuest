import { Injectable } from '@nestjs/common'

import { DatabaseService } from '../database/database.service'
import type { DiscoverFetchFailure } from '../discover/discover-http-client'
import type { DiscoverSource } from '../discover/discover.types'
import { DISCOVER_SOURCES } from '../discover/discover.types'

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

type DiscoverFetchTerminalResult = 'SUCCESS' | 'FAILURE' | 'SKIPPED_LOCKED'

interface DiscoverLatencyHistogram {
  source: DiscoverSource
  result: DiscoverFetchTerminalResult
  buckets: number[]
  count: number
  sum: number
}

const DISCOVER_LATENCY_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]

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
  private readonly discoverRefreshCounters = new Map<string, DiscoverCounter>()
  private readonly discoverEnabledSources = new Set<DiscoverSource>()
  private readonly discoverFetchLatency = new Map<string, DiscoverLatencyHistogram>()

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

  recordDiscoverRefreshItems(source: DiscoverSource, itemCount: number) {
    this.incrementDiscoverCounter(
      this.discoverRefreshCounters,
      source,
      itemCount === 0 ? 'EMPTY' : 'NON_EMPTY',
    )
  }

  configureDiscoverSources(sources: readonly DiscoverSource[]) {
    this.discoverEnabledSources.clear()
    for (const source of sources) this.discoverEnabledSources.add(source)
  }

  recordDiscoverFetchDuration(
    source: DiscoverSource,
    result: DiscoverFetchTerminalResult,
    durationSeconds: number,
  ) {
    const key = `${source}:${result}`
    const histogram = this.discoverFetchLatency.get(key) ?? {
      source,
      result,
      buckets: DISCOVER_LATENCY_BUCKETS.map(() => 0),
      count: 0,
      sum: 0,
    }
    histogram.count += 1
    histogram.sum += Math.max(0, durationSeconds)
    DISCOVER_LATENCY_BUCKETS.forEach((upperBound, index) => {
      if (durationSeconds <= upperBound) histogram.buckets[index] += 1
    })
    this.discoverFetchLatency.set(key, histogram)
  }

  async renderPrometheus() {
    const [snapshot, discoverSnapshot] = await Promise.all([
      this.databaseService.getOperationalSnapshot(),
      this.databaseService.getDiscoverOperationalSnapshot(),
    ])
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
      '# HELP aisidequest_discover_source_refresh_total Successful normalized source refreshes by empty result.',
      '# TYPE aisidequest_discover_source_refresh_total counter',
      ...[...this.discoverRefreshCounters.values()].map((counter) =>
        `aisidequest_discover_source_refresh_total{source="${counter.source}",result="${counter.result}"} ${counter.count}`),
      '# HELP aisidequest_discover_source_enabled Whether a Discover source adapter is enabled.',
      '# TYPE aisidequest_discover_source_enabled gauge',
      ...DISCOVER_SOURCES.map((source) =>
        `aisidequest_discover_source_enabled{source="${source}"} ${this.discoverEnabledSources.has(source) ? 1 : 0}`),
      '# HELP aisidequest_discover_source_freshness_seconds Seconds since the last successful normalized source refresh.',
      '# TYPE aisidequest_discover_source_freshness_seconds gauge',
      ...discoverSnapshot.sources.map((source) =>
        `aisidequest_discover_source_freshness_seconds{source="${metricLabel(source.source)}"} ${source.freshnessSeconds}`),
      '# HELP aisidequest_discover_source_item_count Normalized items in the latest source cache.',
      '# TYPE aisidequest_discover_source_item_count gauge',
      ...discoverSnapshot.sources.map((source) =>
        `aisidequest_discover_source_item_count{source="${metricLabel(source.source)}"} ${source.itemCount}`),
      '# HELP aisidequest_discover_source_fetch_duration_seconds Discover source refresh latency.',
      '# TYPE aisidequest_discover_source_fetch_duration_seconds histogram',
      ...this.renderDiscoverLatencyHistograms(),
      '# HELP aisidequest_discover_product_events_30d Owned Discover analytics events in the rolling 30-day operational window.',
      '# TYPE aisidequest_discover_product_events_30d gauge',
      ...discoverSnapshot.productEvents30d.map((event) =>
        `aisidequest_discover_product_events_30d{event="${metricLabel(event.eventName)}",source="${metricLabel(event.source)}",category="${metricLabel(event.category)}"} ${event.count}`),
      '',
    ]

    return lines.join('\n')
  }

  private renderDiscoverLatencyHistograms() {
    return [...this.discoverFetchLatency.values()].flatMap((histogram) => {
      const labels = `source="${histogram.source}",result="${histogram.result}"`
      return [
        ...DISCOVER_LATENCY_BUCKETS.map((upperBound, index) =>
          `aisidequest_discover_source_fetch_duration_seconds_bucket{${labels},le="${upperBound}"} ${histogram.buckets[index]}`),
        `aisidequest_discover_source_fetch_duration_seconds_bucket{${labels},le="+Inf"} ${histogram.count}`,
        `aisidequest_discover_source_fetch_duration_seconds_sum{${labels}} ${histogram.sum}`,
        `aisidequest_discover_source_fetch_duration_seconds_count{${labels}} ${histogram.count}`,
      ]
    })
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
