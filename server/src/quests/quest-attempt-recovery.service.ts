import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'

import { DatabaseService } from '../database/database.service'

const RECOVERY_INTERVAL_MS = 30_000
const RECOVERY_LOCK_KEY = 'AISIDEQUEST:QUEST_ATTEMPT_RECOVERY'

interface LockRow { locked: boolean }
interface CountRow { count: number }

@Injectable()
export class QuestAttemptRecoveryService
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
    if (this.interval) clearInterval(this.interval)
    this.interval = undefined
  }

  async runCleanup() {
    if (this.running) return { skipped: true, attemptsExpired: 0 }
    this.running = true

    try {
      return await this.databaseService.transaction(async (manager) => {
        const locks = (await manager.query(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
          [RECOVERY_LOCK_KEY],
        )) as LockRow[]
        if (!locks[0]?.locked) return { skipped: true, attemptsExpired: 0 }

        const rows = (await manager.query(`
          WITH expired AS (
            UPDATE quest_attempts attempt
            SET status = 'EXPIRED',
                completed_at = session.ended_at + interval '5 minutes',
                updated_at = clock_timestamp()
            FROM ai_sessions session
            WHERE attempt.ai_session_id = session.id
              AND attempt.status IN ('IN_PROGRESS', 'SUBMITTED')
              AND session.status NOT IN ('RUNNING', 'WAITING_FOR_USER')
              AND session.ended_at + interval '5 minutes' < clock_timestamp()
            RETURNING 1
          )
          SELECT count(*)::integer AS count FROM expired
        `)) as CountRow[]

        return {
          skipped: false,
          attemptsExpired: rows[0]?.count ?? 0,
        }
      })
    } finally {
      this.running = false
    }
  }
}
