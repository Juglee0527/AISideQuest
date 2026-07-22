import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import type { EntityManager } from 'typeorm'

import { hashToken } from '../auth/auth-crypto'
import { ApiIdempotencyService } from '../common/idempotency/api-idempotency.service'
import { DatabaseService } from '../database/database.service'
import { validationError } from '../sessions/session-input'
import type {
  DiscoverAnalyticsEvent,
  DiscoverCategory,
  DiscoverClientAnalyticsEvent,
  DiscoverSource,
} from './discover.types'

const ANALYTICS_RETENTION_DAYS = 90
const ANALYTICS_PURGE_INTERVAL_MS = 30 * 60_000

@Injectable()
export class DiscoverAnalyticsService implements OnModuleInit, OnModuleDestroy {
  private purgeTimer?: NodeJS.Timeout

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly idempotencyService: ApiIdempotencyService,
  ) {}

  onModuleInit() {
    this.purgeExpiredSafely()
    this.purgeTimer = setInterval(() => this.purgeExpiredSafely(), ANALYTICS_PURGE_INTERVAL_MS)
    this.purgeTimer.unref()
  }

  onModuleDestroy() {
    if (this.purgeTimer) clearInterval(this.purgeTimer)
  }

  recordClientEvent(
    userId: string,
    eventName: DiscoverClientAnalyticsEvent,
    source: DiscoverSource | undefined,
    category: DiscoverCategory | undefined,
    idempotencyKey: string,
  ) {
    this.assertDimensions(eventName, source, category)
    const requestHash = hashToken(JSON.stringify({ eventName, source, category }))
    return this.databaseService.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`AISIDEQUEST:IDEMPOTENCY:${userId}:${idempotencyKey}`],
      )
      const stored = await this.idempotencyService.getResponse<{ recorded: true }>(
        manager,
        userId,
        idempotencyKey,
        requestHash,
      )
      if (stored) return stored

      await this.insertEvent(manager, userId, eventName, source, category)
      const response = { recorded: true as const }
      await this.idempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        'DISCOVER_ANALYTICS_EVENT',
        requestHash,
        response,
      )
      return response
    })
  }

  recordSave(
    manager: EntityManager,
    userId: string,
    source: DiscoverSource,
    category: DiscoverCategory,
  ) {
    return this.insertEvent(manager, userId, 'SAVE', source, category)
  }

  private insertEvent(
    manager: EntityManager,
    userId: string,
    eventName: DiscoverAnalyticsEvent,
    source?: DiscoverSource,
    category?: DiscoverCategory,
  ) {
    return manager.query(`
      INSERT INTO discover_analytics_events (
        user_id, event_name, source, category, occurred_at, expires_at
      ) VALUES (
        $1, $2, $3, $4, clock_timestamp(),
        clock_timestamp() + interval '${ANALYTICS_RETENTION_DAYS} days'
      )
    `, [userId, eventName, source ?? null, category ?? null])
  }

  private assertDimensions(
    eventName: DiscoverClientAnalyticsEvent,
    source?: DiscoverSource,
    category?: DiscoverCategory,
  ) {
    const valid = eventName === 'DISCOVER_VIEW'
      ? source === undefined && category === undefined
      : eventName === 'TAB_VIEW'
        ? source === undefined && category !== undefined
        : source !== undefined && category !== undefined
    if (!valid) validationError('analytics dimensions do not match the event')
  }

  private purgeExpiredSafely() {
    void Promise.resolve()
      .then(() => this.databaseService.query(`
        DELETE FROM discover_analytics_events WHERE expires_at <= clock_timestamp()
      `))
      .catch(() => undefined)
  }
}
