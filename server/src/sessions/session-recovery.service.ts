import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import type { EntityManager } from 'typeorm'

import { DatabaseService } from '../database/database.service'

const RECOVERY_INTERVAL_MS = 30_000
const RECOVERY_LOCK_KEY = 'AI_SESSION_RECOVERY_V1'

interface AdvisoryLockRow {
  acquired: boolean
}

export interface SessionRecoveryResult {
  acquired: boolean
  heartbeatTimeouts: number
  manualTimeouts: number
  ignoredOrphans: number
}

@Injectable()
export class SessionRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionRecoveryService.name)
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly databaseService: DatabaseService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runRecoveryCycle().catch(() => {
        this.logger.error('AI session recovery cycle failed')
      })
    }, RECOVERY_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  runRecoveryCycle(): Promise<SessionRecoveryResult> {
    return this.databaseService.transaction(async (manager) => {
      const [lock] = (await manager.query(
        `
          SELECT pg_try_advisory_xact_lock(
            hashtextextended($1, 0)
          ) AS acquired
        `,
        [RECOVERY_LOCK_KEY],
      )) as AdvisoryLockRow[]

      if (!lock?.acquired) {
        return this.emptyResult(false)
      }

      return this.recoverExpiredState(manager)
    })
  }

  private async recoverExpiredState(
    manager: EntityManager,
  ): Promise<SessionRecoveryResult> {
    const [heartbeatTimeouts] = (await manager.query(`
      UPDATE ai_sessions
      SET status = 'ABANDONED',
          ended_at = GREATEST(
            started_at,
            last_activity_at + interval '120 seconds'
          ),
          terminal_reason = 'HEARTBEAT_TIMEOUT',
          version = version + 1,
          updated_at = clock_timestamp()
      WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
        AND external_turn_key IS NOT NULL
        AND last_activity_at <= clock_timestamp() - interval '120 seconds'
      RETURNING id
    `)) as [Array<{ id: string }>, number]

    const [manualTimeouts] = (await manager.query(`
      UPDATE ai_sessions
      SET status = 'ABANDONED',
          ended_at = started_at + interval '12 hours',
          terminal_reason = 'MANUAL_TIMEOUT',
          version = version + 1,
          updated_at = clock_timestamp()
      WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
        AND external_turn_key IS NULL
        AND started_at <= clock_timestamp() - interval '12 hours'
      RETURNING id
    `)) as [Array<{ id: string }>, number]

    const [ignoredOrphans] = (await manager.query(`
      UPDATE integration_events
      SET processing_result = 'IGNORED_ORPHAN',
          response_body = jsonb_build_object(
            'eventId', event_id,
            'result', 'IGNORED_ORPHAN',
            'session', NULL
          )
      WHERE processing_result = 'DEFERRED'
        AND received_at <= clock_timestamp() - interval '24 hours'
      RETURNING id
    `)) as [Array<{ id: string }>, number]

    return {
      acquired: true,
      heartbeatTimeouts: heartbeatTimeouts.length,
      manualTimeouts: manualTimeouts.length,
      ignoredOrphans: ignoredOrphans.length,
    }
  }

  private emptyResult(acquired: boolean): SessionRecoveryResult {
    return {
      acquired,
      heartbeatTimeouts: 0,
      manualTimeouts: 0,
      ignoredOrphans: 0,
    }
  }
}
