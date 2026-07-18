import { ConflictException, Injectable } from '@nestjs/common'
import type { EntityManager } from 'typeorm'

export type ApiIdempotencyOperation =
  | 'SESSION_MANUAL_START'
  | 'SESSION_END'
  | 'DEVICE_LINK_CREATE'
  | 'DEVICE_ROTATION_LINK_CREATE'
  | 'DEVICE_LINK_REDEEM'
  | 'DEVICE_LINK_REQUEST_APPROVE'
  | 'DEVICE_REVOKE'
  | 'QUEST_ATTEMPT_START'
  | 'QUEST_ATTEMPT_SUBMIT'

interface StoredIdempotencyRow {
  request_hash: string
  response_body: unknown
}

@Injectable()
export class ApiIdempotencyService {
  async getResponse<T>(
    manager: EntityManager,
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<T | undefined> {
    const rows = (await manager.query(
      `
        SELECT request_hash, response_body
        FROM api_idempotency_keys
        WHERE user_id = $1 AND idempotency_key = $2
      `,
      [userId, idempotencyKey],
    )) as StoredIdempotencyRow[]
    const stored = rows[0]

    if (!stored) {
      return undefined
    }

    if (stored.request_hash !== requestHash) {
      throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' })
    }

    return stored.response_body as T
  }

  async storeResponse(
    manager: EntityManager,
    userId: string,
    idempotencyKey: string,
    operation: ApiIdempotencyOperation,
    requestHash: string,
    response: unknown,
  ) {
    await manager.query(
      `
        INSERT INTO api_idempotency_keys (
          user_id,
          idempotency_key,
          operation,
          request_hash,
          response_body
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        userId,
        idempotencyKey,
        operation,
        requestHash,
        JSON.stringify(response),
      ],
    )
  }
}
