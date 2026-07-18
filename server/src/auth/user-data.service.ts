import { Injectable, NotFoundException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'

import { DatabaseService } from '../database/database.service'

type SafeRow = Record<string, string | number | boolean | Date | null>

@Injectable()
export class UserDataService {
  constructor(private readonly databaseService: DatabaseService) {}

  async exportUserData(userId: string) {
    return this.databaseService.transaction(async (manager) => {
      const profile = await this.first(manager, `
        SELECT id, display_name, avatar_url, time_zone, time_zone_verified,
               created_at, updated_at
        FROM users
        WHERE id = $1 AND deleted_at IS NULL
      `, userId)

      if (!profile) {
        throw new NotFoundException({ code: 'USER_NOT_FOUND' })
      }

      const accounts = await this.rows(manager, `
            SELECT provider, provider_login, created_at, updated_at
            FROM user_auth_accounts WHERE user_id = $1
            ORDER BY created_at, id
          `, userId)
      const devices = await this.rows(manager, `
            SELECT id, name, plugin_version, last_seen_at, expires_at,
                   revoked_at, created_at, updated_at
            FROM devices WHERE user_id = $1 ORDER BY created_at, id
          `, userId)
      const sessions = await this.rows(manager, `
            SELECT id, provider, status, origin, started_at, ended_at,
                   last_activity_at, terminal_reason, timing_quality,
                   version, created_at, updated_at
            FROM ai_sessions WHERE user_id = $1 ORDER BY started_at, id
          `, userId)
      const events = await this.rows(manager, `
            SELECT event_id, device_id, ai_session_id, provider, event,
                   sequence, observed_at, received_at, processing_result
            FROM integration_events WHERE user_id = $1
            ORDER BY received_at, id
          `, userId)
      const attempts = await this.rows(manager, `
            SELECT attempt.id, quest.code AS quest_code,
                   quest.version AS quest_version, attempt.ai_session_id,
                   attempt.status, attempt.started_at, attempt.submitted_at,
                   attempt.completed_at, attempt.score, attempt.passed,
                   attempt.reward_points_snapshot
            FROM quest_attempts attempt
            JOIN quests quest ON quest.id = attempt.quest_id
            WHERE attempt.user_id = $1 ORDER BY attempt.started_at, attempt.id
          `, userId)
      const answers = await this.rows(manager, `
            SELECT answer.attempt_id, question.position AS question_position,
                   option.position AS selected_option_position,
                   answer.is_correct, answer.answered_at
            FROM quest_attempt_answers answer
            JOIN quest_attempts attempt ON attempt.id = answer.attempt_id
            JOIN quest_questions question ON question.id = answer.question_id
            JOIN quest_options option ON option.id = answer.selected_option_id
            WHERE attempt.user_id = $1
            ORDER BY answer.attempt_id, question.position
          `, userId)
      const points = await this.rows(manager, `
            SELECT ledger.id, quest.code AS quest_code,
                   quest.version AS quest_version, ledger.quest_attempt_id,
                   ledger.entry_type, ledger.points, ledger.description,
                   ledger.created_at
            FROM point_ledger ledger
            JOIN quests quest ON quest.id = ledger.quest_id
            WHERE ledger.user_id = $1 ORDER BY ledger.created_at, ledger.id
          `, userId)

      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        profile: this.camelize(profile),
        connectedAccounts: accounts.map((row) => this.camelize(row)),
        devices: devices.map((row) => this.camelize(row)),
        aiSessions: sessions.map((row) => this.camelize(row)),
        integrationEvents: events.map((row) => this.camelize(row)),
        questAttempts: attempts.map((row) => this.camelize(row)),
        questAnswers: answers.map((row) => this.camelize(row)),
        pointLedger: points.map((row) => this.camelize(row)),
      }
    })
  }

  async deleteAccount(userId: string) {
    await this.databaseService.transaction(async (manager) => {
      const user = await this.first(manager, `
        SELECT id FROM users
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE
      `, userId)

      if (!user) {
        throw new NotFoundException({ code: 'USER_NOT_FOUND' })
      }

      await manager.query('DELETE FROM point_ledger WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM quest_attempts WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM integration_events WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM ai_sessions WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM device_link_codes WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM devices WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM api_idempotency_keys WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM user_auth_accounts WHERE user_id = $1', [userId])
      await manager.query('DELETE FROM users WHERE id = $1', [userId])
    })

    return {
      deleted: true,
      localPluginAction:
        'AISideQuest 플러그인의 로컬 연결 정보와 durable queue를 이 기기에서 삭제해 주세요.',
    }
  }

  private async first(manager: EntityManager, sql: string, userId: string) {
    const rows = await this.rows(manager, sql, userId)
    return rows[0]
  }

  private rows(manager: EntityManager, sql: string, userId: string) {
    return manager.query(sql, [userId]) as Promise<SafeRow[]>
  }

  private camelize(row: SafeRow) {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
        value instanceof Date ? value.toISOString() : value,
      ]),
    )
  }
}
