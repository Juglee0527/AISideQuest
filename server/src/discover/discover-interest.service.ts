import { Injectable } from '@nestjs/common'

import { hashToken } from '../auth/auth-crypto'
import { ApiIdempotencyService } from '../common/idempotency/api-idempotency.service'
import { DatabaseService } from '../database/database.service'
import {
  DISCOVER_INTEREST_TAGS,
  type DiscoverInterestTag,
  type DiscoverInterests,
} from './discover.types'

interface InterestRow {
  tags: DiscoverInterestTag[]
  updated_at: Date | string
}

@Injectable()
export class DiscoverInterestService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly idempotencyService: ApiIdempotencyService,
  ) {}

  async getInterests(userId: string): Promise<DiscoverInterests> {
    const rows = await this.databaseService.query<InterestRow[]>(`
      SELECT tags, updated_at
      FROM discover_user_interests
      WHERE user_id = $1
    `, [userId])
    return this.toInterests(rows[0])
  }

  updateInterests(
    userId: string,
    requestedTags: readonly DiscoverInterestTag[],
    idempotencyKey: string,
  ) {
    const tags = DISCOVER_INTEREST_TAGS.filter((tag) => requestedTags.includes(tag))
    const requestHash = hashToken(JSON.stringify({
      operation: 'DISCOVER_INTERESTS_UPDATE',
      tags,
    }))

    return this.databaseService.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`AISIDEQUEST:IDEMPOTENCY:${userId}:${idempotencyKey}`],
      )
      const stored = await this.idempotencyService.getResponse<DiscoverInterests>(
        manager,
        userId,
        idempotencyKey,
        requestHash,
      )
      if (stored) return stored

      const currentRows = await manager.query(`
        SELECT tags, updated_at
        FROM discover_user_interests
        WHERE user_id = $1
        FOR UPDATE
      `, [userId]) as InterestRow[]
      const current = this.toInterests(currentRows[0])
      let response = current

      if (!sameTags(current.tags, tags)) {
        if (tags.length === 0) {
          await manager.query(
            'DELETE FROM discover_user_interests WHERE user_id = $1',
            [userId],
          )
          response = { tags: [], updatedAt: null }
        } else {
          const rows = await manager.query(`
            INSERT INTO discover_user_interests (user_id, tags, updated_at)
            VALUES ($1, $2::text[], clock_timestamp())
            ON CONFLICT (user_id) DO UPDATE
            SET tags = EXCLUDED.tags,
                updated_at = EXCLUDED.updated_at
            RETURNING tags, updated_at
          `, [userId, tags]) as InterestRow[]
          response = this.toInterests(rows[0])
        }
      }

      await this.idempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        'DISCOVER_INTERESTS_UPDATE',
        requestHash,
        response,
      )
      return response
    })
  }

  private toInterests(row: InterestRow | undefined): DiscoverInterests {
    if (!row) return { tags: [], updatedAt: null }
    const tags = DISCOVER_INTEREST_TAGS.filter((tag) => row.tags.includes(tag))
    return { tags, updatedAt: new Date(row.updated_at).toISOString() }
  }
}

function sameTags(
  left: readonly DiscoverInterestTag[],
  right: readonly DiscoverInterestTag[],
) {
  return left.length === right.length && left.every((tag, index) => tag === right[index])
}
