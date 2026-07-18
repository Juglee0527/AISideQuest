import { Injectable, InternalServerErrorException } from '@nestjs/common'

import { DatabaseService } from '../database/database.service'
import { validationError } from '../sessions/session-input'
import type { PointLedgerQueryDto } from './point.dto'
import type {
  PointBalanceRow,
  PointLedgerCursor,
  PointLedgerRow,
} from './point.types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

@Injectable()
export class PointService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getBalance(userId: string) {
    const rows = await this.databaseService.query<PointBalanceRow[]>(
      `SELECT COALESCE(sum(points), 0)::text AS balance
       FROM point_ledger
       WHERE user_id = $1`,
      [userId],
    )
    const balance = Number(rows[0]?.balance ?? '0')
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new InternalServerErrorException({ code: 'POINT_BALANCE_OVERFLOW' })
    }
    return { balance }
  }

  async listLedger(userId: string, query: PointLedgerQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null
    const rows = await this.databaseService.query<PointLedgerRow[]>(
      `SELECT ledger.id,
              ledger.quest_attempt_id,
              ledger.entry_type,
              ledger.points,
              ledger.description,
              ledger.created_at,
              quest.id AS quest_id,
              quest.code AS quest_code,
              quest.version AS quest_version,
              quest.title AS quest_title
       FROM point_ledger ledger
       JOIN quests quest ON quest.id = ledger.quest_id
       WHERE ledger.user_id = $1
         AND (
           $2::timestamptz IS NULL
           OR ledger.created_at < $2::timestamptz
           OR (ledger.created_at = $2::timestamptz AND ledger.id < $3::uuid)
         )
       ORDER BY ledger.created_at DESC, ledger.id DESC
       LIMIT $4`,
      [userId, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
    )
    const hasNextPage = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const last = pageRows.at(-1)

    return {
      items: pageRows.map((row) => ({
        id: row.id,
        attemptId: row.quest_attempt_id,
        entryType: row.entry_type,
        points: row.points,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        quest: {
          id: row.quest_id,
          code: row.quest_code,
          version: row.quest_version,
          title: row.quest_title,
        },
      })),
      nextCursor: hasNextPage && last
        ? this.encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
        : null,
    }
  }

  private encodeCursor(cursor: PointLedgerCursor) {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(cursor: string): PointLedgerCursor {
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
      || !('createdAt' in value)
      || typeof value.createdAt !== 'string'
      || !Number.isFinite(Date.parse(value.createdAt))
      || !('id' in value)
      || typeof value.id !== 'string'
      || !UUID_PATTERN.test(value.id)
    ) {
      validationError('cursor is invalid')
    }

    return {
      createdAt: new Date(value.createdAt).toISOString(),
      id: value.id.toLowerCase(),
    }
  }
}
