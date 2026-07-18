import { Injectable, InternalServerErrorException } from '@nestjs/common'

import { DatabaseService } from '../database/database.service'
import { validationError } from '../sessions/session-input'
import type {
  StatisticsActivityQueryDto,
  StatisticsSummaryQueryDto,
} from './statistics.dto'
import type {
  StatisticsActivityRow,
  StatisticsCursor,
  StatisticsRow,
} from './statistics.types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIVITY_TYPES = new Set(['AI_SESSION', 'QUEST_COMPLETED'])

const CONTEXT_RANGE_CTE = `
  stats_context AS (
    SELECT transaction_timestamp() AS as_of,
           users.time_zone,
           users.time_zone_verified
    FROM users
    WHERE users.id = $1 AND users.deleted_at IS NULL
  ),
  range_bounds AS (
    SELECT context.as_of,
           context.time_zone,
           context.time_zone_verified,
           CASE $2::text
             WHEN 'today' THEN
               date_trunc('day', context.as_of AT TIME ZONE context.time_zone)
                 AT TIME ZONE context.time_zone
             WHEN 'week' THEN
               date_trunc('week', context.as_of AT TIME ZONE context.time_zone)
                 AT TIME ZONE context.time_zone
             WHEN 'month' THEN
               date_trunc('month', context.as_of AT TIME ZONE context.time_zone)
                 AT TIME ZONE context.time_zone
             ELSE $3::date::timestamp AT TIME ZONE context.time_zone
           END AS start_at,
           CASE $2::text
             WHEN 'today' THEN
               (date_trunc('day', context.as_of AT TIME ZONE context.time_zone) + interval '1 day')
                 AT TIME ZONE context.time_zone
             WHEN 'week' THEN
               (date_trunc('week', context.as_of AT TIME ZONE context.time_zone) + interval '7 days')
                 AT TIME ZONE context.time_zone
             WHEN 'month' THEN
               (date_trunc('month', context.as_of AT TIME ZONE context.time_zone) + interval '1 month')
                 AT TIME ZONE context.time_zone
             ELSE $4::date::timestamp AT TIME ZONE context.time_zone
           END AS end_at
    FROM stats_context context
  )
`

@Injectable()
export class StatisticsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getSummary(userId: string, query: StatisticsSummaryQueryDto) {
    this.validateRange(query)
    const rows = await this.databaseService.query<StatisticsRow[]>(
      `WITH ${CONTEXT_RANGE_CTE},
       session_stats AS (
         SELECT COALESCE(sum(
                  floor(extract(epoch FROM (
                    LEAST(COALESCE(session.ended_at, range.as_of), range.as_of, range.end_at)
                    - GREATEST(session.started_at, range.start_at)
                  )) * 1000)
                ), 0)::bigint::text AS wait_duration_ms,
                count(session.id)::integer AS session_count,
                count(session.id) FILTER (WHERE session.timing_quality = 'DEGRADED')::integer
                  AS degraded_session_count
         FROM range_bounds range
         LEFT JOIN ai_sessions session
           ON session.user_id = $1
          AND range.start_at < LEAST(range.end_at, range.as_of)
          AND session.started_at < LEAST(range.end_at, range.as_of)
          AND COALESCE(session.ended_at, range.as_of) > range.start_at
       ),
       reward_stats AS (
         SELECT count(ledger.id)::integer AS completed_quest_count,
                COALESCE(sum(ledger.points), 0)::bigint::text AS points_earned
         FROM range_bounds range
         LEFT JOIN point_ledger ledger
           ON ledger.user_id = $1
          AND range.start_at < LEAST(range.end_at, range.as_of)
          AND ledger.created_at >= range.start_at
          AND ledger.created_at < LEAST(range.end_at, range.as_of)
       )
       SELECT range.as_of,
              range.time_zone,
              range.time_zone_verified,
              range.start_at,
              range.end_at,
              sessions.wait_duration_ms,
              sessions.session_count,
              sessions.degraded_session_count,
              rewards.completed_quest_count,
              rewards.points_earned
       FROM range_bounds range
       CROSS JOIN session_stats sessions
       CROSS JOIN reward_stats rewards`,
      [userId, query.period, query.start ?? null, query.end ?? null],
    )
    const row = rows[0]
    if (!row) throw new InternalServerErrorException({ code: 'STATISTICS_CONTEXT_MISSING' })
    return this.toSummary(query.period, row)
  }

  async listActivity(userId: string, query: StatisticsActivityQueryDto) {
    this.validateRange(query)
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null
    const rows = await this.databaseService.query<StatisticsActivityRow[]>(
      `WITH ${CONTEXT_RANGE_CTE},
       activities AS (
         SELECT 'AI_SESSION'::text AS activity_type,
                session.id,
                GREATEST(session.started_at, range.start_at) AS occurred_at,
                floor(extract(epoch FROM (
                  LEAST(COALESCE(session.ended_at, range.as_of), range.as_of, range.end_at)
                  - GREATEST(session.started_at, range.start_at)
                )) * 1000)::bigint::text AS duration_ms,
                session.status::text AS status,
                session.timing_quality::text AS timing_quality,
                NULL::integer AS points,
                NULL::text AS quest_code,
                NULL::integer AS quest_version,
                NULL::text AS quest_title
         FROM range_bounds range
         JOIN ai_sessions session
           ON session.user_id = $1
          AND range.start_at < LEAST(range.end_at, range.as_of)
          AND session.started_at < LEAST(range.end_at, range.as_of)
          AND COALESCE(session.ended_at, range.as_of) > range.start_at
         UNION ALL
         SELECT 'QUEST_COMPLETED'::text,
                ledger.id,
                ledger.created_at,
                NULL::text,
                NULL::text,
                NULL::text,
                ledger.points,
                quest.code,
                quest.version,
                quest.title
         FROM range_bounds range
         JOIN point_ledger ledger
           ON ledger.user_id = $1
          AND range.start_at < LEAST(range.end_at, range.as_of)
          AND ledger.created_at >= range.start_at
          AND ledger.created_at < LEAST(range.end_at, range.as_of)
         JOIN quests quest ON quest.id = ledger.quest_id
       )
       SELECT activity.*,
              range.as_of,
              range.time_zone,
              range.time_zone_verified,
              range.start_at,
              range.end_at
       FROM activities activity
       CROSS JOIN range_bounds range
       WHERE (
         $5::timestamptz IS NULL
         OR activity.occurred_at < $5::timestamptz
         OR (activity.occurred_at = $5::timestamptz AND activity.activity_type > $6)
         OR (
           activity.occurred_at = $5::timestamptz
           AND activity.activity_type = $6
           AND activity.id < $7::uuid
         )
       )
       ORDER BY activity.occurred_at DESC, activity.activity_type, activity.id DESC
       LIMIT $8`,
      [
        userId,
        query.period,
        query.start ?? null,
        query.end ?? null,
        cursor?.occurredAt ?? null,
        cursor?.type ?? '',
        cursor?.id ?? null,
        query.limit + 1,
      ],
    )
    const hasNextPage = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const last = pageRows.at(-1)
    const context = pageRows[0]
    if (!context) {
      const summary = await this.getSummary(userId, query)
      return {
        period: query.period,
        asOf: summary.asOf,
        timeZone: summary.timeZone,
        range: summary.range,
        items: [],
        nextCursor: null,
      }
    }

    return {
      period: query.period,
      asOf: context.as_of.toISOString(),
      timeZone: { id: context.time_zone, verified: context.time_zone_verified },
      range: { startAt: context.start_at.toISOString(), endAt: context.end_at.toISOString() },
      items: pageRows.map((row) => this.toActivity(row)),
      nextCursor: hasNextPage && last
        ? this.encodeCursor({
            occurredAt: last.occurred_at.toISOString(),
            type: last.activity_type,
            id: last.id,
          })
        : null,
    }
  }

  private toSummary(period: StatisticsSummaryQueryDto['period'], row: StatisticsRow) {
    return {
      period,
      asOf: row.as_of.toISOString(),
      timeZone: { id: row.time_zone, verified: row.time_zone_verified },
      range: { startAt: row.start_at.toISOString(), endAt: row.end_at.toISOString() },
      ai: {
        waitDurationMs: this.safeInteger(row.wait_duration_ms),
        sessionCount: row.session_count,
        degradedSessionCount: row.degraded_session_count,
      },
      quests: { completedCount: row.completed_quest_count },
      points: { earned: this.safeInteger(row.points_earned) },
    }
  }

  private toActivity(row: StatisticsActivityRow) {
    return row.activity_type === 'AI_SESSION'
      ? {
          type: row.activity_type,
          id: row.id,
          occurredAt: row.occurred_at.toISOString(),
          durationMs: this.safeInteger(row.duration_ms ?? '0'),
          status: row.status,
          timingQuality: row.timing_quality,
        }
      : {
          type: row.activity_type,
          id: row.id,
          occurredAt: row.occurred_at.toISOString(),
          points: row.points,
          quest: {
            code: row.quest_code,
            version: row.quest_version,
            title: row.quest_title,
          },
        }
  }

  private safeInteger(value: string) {
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new InternalServerErrorException({ code: 'STATISTICS_VALUE_OVERFLOW' })
    }
    return number
  }

  private validateRange(query: StatisticsSummaryQueryDto) {
    if (query.period !== 'custom') {
      if (query.start || query.end) validationError('start and end require period=custom')
      return
    }
    if (!query.start || !query.end) validationError('custom period requires start and end')
    const start = this.parseDate(query.start, 'start')
    const end = this.parseDate(query.end, 'end')
    const days = (end.getTime() - start.getTime()) / 86_400_000
    if (days <= 0 || days > 366) {
      validationError('custom period must be between 1 and 366 days')
    }
  }

  private parseDate(value: string, name: string) {
    const date = new Date(`${value}T00:00:00.000Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      validationError(`${name} must be a valid calendar date`)
    }
    return date
  }

  private encodeCursor(cursor: StatisticsCursor) {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(cursor: string): StatisticsCursor {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) validationError('cursor is invalid')
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
      || !('occurredAt' in value)
      || typeof value.occurredAt !== 'string'
      || !Number.isFinite(Date.parse(value.occurredAt))
      || !('type' in value)
      || typeof value.type !== 'string'
      || !ACTIVITY_TYPES.has(value.type)
      || !('id' in value)
      || typeof value.id !== 'string'
      || !UUID_PATTERN.test(value.id)
    ) validationError('cursor is invalid')
    return {
      occurredAt: new Date(value.occurredAt).toISOString(),
      type: value.type as StatisticsCursor['type'],
      id: value.id.toLowerCase(),
    }
  }
}
