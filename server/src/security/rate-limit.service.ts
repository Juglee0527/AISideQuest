import { Injectable } from '@nestjs/common'

import { hashToken } from '../auth/auth-crypto'
import { DatabaseService } from '../database/database.service'

interface RateLimitRow {
  request_count: number
}

@Injectable()
export class RateLimitService {
  private lastCleanupAt = 0

  constructor(private readonly databaseService: DatabaseService) {}

  async consume(
    scope: string,
    identity: string,
    limit: number,
    windowSeconds: number,
  ) {
    await this.cleanupExpiredBuckets()
    const rows = await this.databaseService.query<RateLimitRow[]>(
      `
        INSERT INTO rate_limit_buckets (
          scope, key_hash, window_started_at, request_count, expires_at
        )
        VALUES (
          $1,
          $2,
          to_timestamp(floor(extract(epoch FROM now()) / $3) * $3),
          1,
          to_timestamp((floor(extract(epoch FROM now()) / $3) + 1) * $3)
        )
        ON CONFLICT (scope, key_hash, window_started_at)
        DO UPDATE SET request_count = rate_limit_buckets.request_count + 1
        RETURNING request_count
      `,
      [scope, hashToken(identity), windowSeconds],
    )
    const count = rows[0]?.request_count ?? limit + 1

    return {
      allowed: count <= limit,
      retryAfterSeconds: windowSeconds,
    }
  }

  private async cleanupExpiredBuckets() {
    const now = Date.now()

    if (now - this.lastCleanupAt < 60_000) {
      return
    }

    this.lastCleanupAt = now
    await this.databaseService.query(
      "DELETE FROM rate_limit_buckets WHERE expires_at < now() - interval '1 day'",
    )
  }
}
