import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'

import { DatabaseService } from '../database/database.service'

const RECOVERY_INTERVAL_MS = 30_000
const RECOVERY_LOCK_KEY = 'AISIDEQUEST:SESSION_RECOVERY'

interface LockRow {
  locked: boolean
}

interface CountRow {
  count: number
}

export interface SessionRecoveryResult {
  skipped: boolean
  automaticSessionsExpired: number
  manualSessionsExpired: number
  orphanEventsIgnored: number
}

@Injectable()
export class SessionRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private interval?: ReturnType<typeof setInterval>
  private running = false

  constructor(private readonly databaseService: DatabaseService) {}

  onApplicationBootstrap() {
    this.interval = setInterval(() => {
      void this.runCleanup().catch(() => undefined)
    }, RECOVERY_INTERVAL_MS)
    this.interval.unref()
  }

  onApplicationShutdown() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }

  async runCleanup(): Promise<SessionRecoveryResult> {
    if (this.running) {
      return this.emptyResult(true)
    }

    this.running = true

    try {
      return await this.databaseService.transaction(async (manager) => {
        const lockRows = (await manager.query(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
          [RECOVERY_LOCK_KEY],
        )) as LockRow[]

        if (!lockRows[0]?.locked) {
          return this.emptyResult(true)
        }

        const automaticRows = (await manager.query(`
          WITH expired AS (
            UPDATE ai_sessions
            SET status = 'ABANDONED',
                ended_at = last_activity_at + interval '120 seconds',
                terminal_reason = 'HEARTBEAT_TIMEOUT',
                timing_quality = 'DEGRADED',
                version = version + 1,
                updated_at = clock_timestamp()
            WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
              AND external_turn_key IS NOT NULL
              AND last_activity_at <= clock_timestamp() - interval '120 seconds'
            RETURNING 1
          )
          SELECT count(*)::integer AS count FROM expired
        `)) as CountRow[]

        const manualRows = (await manager.query(`
          WITH expired AS (
            UPDATE ai_sessions
            SET status = 'ABANDONED',
                ended_at = started_at + interval '12 hours',
                last_activity_at = GREATEST(
                  last_activity_at,
                  started_at + interval '12 hours'
                ),
                terminal_reason = 'MANUAL_TIMEOUT',
                timing_quality = 'DEGRADED',
                version = version + 1,
                updated_at = clock_timestamp()
            WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
              AND external_turn_key IS NULL
              AND started_at <= clock_timestamp() - interval '12 hours'
            RETURNING 1
          )
          SELECT count(*)::integer AS count FROM expired
        `)) as CountRow[]

        const orphanRows = (await manager.query(`
          WITH ignored AS (
            UPDATE integration_events
            SET processing_result = 'IGNORED_ORPHAN',
                response_body = jsonb_build_object(
                  'eventId', event_id,
                  'result', 'IGNORED_ORPHAN',
                  'session', NULL
                )
            WHERE processing_result = 'DEFERRED'
              AND received_at <= clock_timestamp() - interval '24 hours'
            RETURNING 1
          )
          SELECT count(*)::integer AS count FROM ignored
        `)) as CountRow[]

        return {
          skipped: false,
          automaticSessionsExpired: automaticRows[0]?.count ?? 0,
          manualSessionsExpired: manualRows[0]?.count ?? 0,
          orphanEventsIgnored: orphanRows[0]?.count ?? 0,
        }
      })
    } finally {
      this.running = false
    }
  }

  private emptyResult(skipped: boolean): SessionRecoveryResult {
    return {
      skipped,
      automaticSessionsExpired: 0,
      manualSessionsExpired: 0,
      orphanEventsIgnored: 0,
    }
  }
}
