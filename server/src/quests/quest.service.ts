import { Injectable, NotFoundException } from '@nestjs/common'

import { DatabaseService } from '../database/database.service'
import { validationError } from '../sessions/session-input'
import type { QuestListQueryDto } from './quest.dto'
import type {
  QuestCompletionStatus,
  QuestRow,
  QuestSnapshot,
} from './quest.types'

const QUEST_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const QUEST_COLUMNS = `
  quest.id,
  quest.code,
  quest.version,
  quest.title,
  quest.description,
  quest.estimated_minutes,
  quest.reward_points,
  quest.pass_score,
  quest.retry_allowed,
  quest.published_at,
  attempt.id AS attempt_id,
  attempt.status AS attempt_status,
  attempt.score AS attempt_score,
  attempt.passed AS attempt_passed,
  attempt.started_at AS attempt_started_at,
  attempt.completed_at AS attempt_completed_at
`

const VALID_PUBLISHED_QUEST = `
  quest.status = 'PUBLISHED'
  AND EXISTS (
    SELECT 1 FROM quest_questions question
    WHERE question.quest_id = quest.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM quest_questions question
    WHERE question.quest_id = quest.id
      AND (
        (SELECT count(*) FROM quest_options option
         WHERE option.question_id = question.id) < 2
        OR
        (SELECT count(*) FROM quest_options option
         WHERE option.question_id = question.id
           AND option.is_correct = true) <> 1
      )
  )
`

interface QuestCursor {
  publishedAt: string
  code: string
  id: string
}

@Injectable()
export class QuestService {
  constructor(private readonly databaseService: DatabaseService) {}

  async listQuests(userId: string, query: QuestListQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null
    const rows = await this.databaseService.query<QuestRow[]>(
      `
        SELECT ${QUEST_COLUMNS}
        FROM quests quest
        LEFT JOIN LATERAL (
          SELECT id, status, score, passed, started_at, completed_at
          FROM quest_attempts
          WHERE user_id = $1 AND quest_id = quest.id
          ORDER BY started_at DESC, id DESC
          LIMIT 1
        ) attempt ON true
        WHERE ${VALID_PUBLISHED_QUEST}
          AND (
            $2::timestamptz IS NULL
            OR quest.published_at < $2::timestamptz
            OR (
              quest.published_at = $2::timestamptz
              AND quest.code > $3
            )
            OR (
              quest.published_at = $2::timestamptz
              AND quest.code = $3
              AND quest.id > $4::uuid
            )
          )
        ORDER BY quest.published_at DESC, quest.code, quest.id
        LIMIT $5
      `,
      [
        userId,
        cursor?.publishedAt ?? null,
        cursor?.code ?? '',
        cursor?.id ?? null,
        query.limit + 1,
      ],
    )
    const hasNextPage = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const last = pageRows.at(-1)

    return {
      items: pageRows.map((row) => this.toSnapshot(row)),
      nextCursor: hasNextPage && last
        ? this.encodeCursor({
            publishedAt: last.published_at.toISOString(),
            code: last.code,
            id: last.id,
          })
        : null,
    }
  }

  async getQuest(userId: string, code: string) {
    if (!QUEST_CODE_PATTERN.test(code)) {
      this.notFound()
    }

    const rows = await this.databaseService.query<QuestRow[]>(
      `
        SELECT ${QUEST_COLUMNS}
        FROM quests quest
        LEFT JOIN LATERAL (
          SELECT id, status, score, passed, started_at, completed_at
          FROM quest_attempts
          WHERE user_id = $1 AND quest_id = quest.id
          ORDER BY started_at DESC, id DESC
          LIMIT 1
        ) attempt ON true
        WHERE quest.code = $2
          AND ${VALID_PUBLISHED_QUEST}
        LIMIT 1
      `,
      [userId, code],
    )

    if (!rows[0]) {
      this.notFound()
    }

    return this.toSnapshot(rows[0])
  }

  private toSnapshot(row: QuestRow): QuestSnapshot {
    let completionStatus: QuestCompletionStatus = 'NOT_STARTED'

    if (row.attempt_passed === true) {
      completionStatus = 'PASSED'
    } else if (
      row.attempt_status === 'IN_PROGRESS'
      || row.attempt_status === 'SUBMITTED'
    ) {
      completionStatus = 'IN_PROGRESS'
    } else if (row.attempt_status === 'COMPLETED' || row.attempt_status === 'FAILED') {
      completionStatus = 'FAILED'
    }

    return {
      id: row.id,
      code: row.code,
      version: row.version,
      title: row.title,
      description: row.description,
      estimatedMinutes: row.estimated_minutes,
      rewardPoints: row.reward_points,
      passScore: row.pass_score,
      retryAllowed: row.retry_allowed,
      completionStatus,
      latestAttempt: row.attempt_id && row.attempt_status && row.attempt_started_at
        ? {
            id: row.attempt_id,
            status: row.attempt_status,
            score: row.attempt_score,
            passed: row.attempt_passed,
            startedAt: row.attempt_started_at.toISOString(),
            completedAt: row.attempt_completed_at?.toISOString() ?? null,
          }
        : null,
    }
  }

  private encodeCursor(cursor: QuestCursor) {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(cursor: string): QuestCursor {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
      validationError('cursor is invalid')
    }

    let value: unknown
    try {
      value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
      validationError('cursor is invalid')
    }

    if (
      typeof value !== 'object'
      || value === null
      || Array.isArray(value)
      || !('publishedAt' in value)
      || typeof value.publishedAt !== 'string'
      || !Number.isFinite(Date.parse(value.publishedAt))
      || !('code' in value)
      || typeof value.code !== 'string'
      || !QUEST_CODE_PATTERN.test(value.code)
      || !('id' in value)
      || typeof value.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
    ) {
      validationError('cursor is invalid')
    }

    return {
      publishedAt: new Date(value.publishedAt).toISOString(),
      code: value.code,
      id: value.id.toLowerCase(),
    }
  }

  private notFound(): never {
    throw new NotFoundException({ code: 'QUEST_NOT_FOUND' })
  }
}
