import { Injectable, NotFoundException } from '@nestjs/common'
import type { EntityManager } from 'typeorm'

import { hashToken } from '../auth/auth-crypto'
import { ApiIdempotencyService } from '../common/idempotency/api-idempotency.service'
import { DatabaseService } from '../database/database.service'
import { validationError } from '../sessions/session-input'
import { DiscoverCacheService } from './discover-cache.service'
import { DiscoverAnalyticsService } from './discover-analytics.service'
import { normalizeDiscoverItem } from './discover-normalization'
import {
  DISCOVER_ITEM_ID_PATTERN,
  DISCOVER_SOURCES,
  type DiscoverItem,
  type DiscoverSavedItem,
  type DiscoverSavedItemReference,
  type DiscoverSource,
} from './discover.types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface SavedItemRow {
  id: string
  source: DiscoverSource
  source_item_id: string
  item: unknown
  saved_at: Date | string
}

interface SavedItemCursor {
  version: 1
  savedAt: string
  id: string
}

@Injectable()
export class DiscoverSavedService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: DiscoverCacheService,
    private readonly idempotencyService: ApiIdempotencyService,
    private readonly analyticsService: DiscoverAnalyticsService,
  ) {}

  async listSavedItems(userId: string, limit: number, cursorValue?: string) {
    const cursor = cursorValue ? this.decodeCursor(cursorValue) : null
    const parameters: unknown[] = [userId]
    let afterCursor = ''
    if (cursor) {
      parameters.push(cursor.savedAt, cursor.id)
      afterCursor = 'AND (saved_at, id) < ($2::timestamptz, $3::uuid)'
    }
    parameters.push(limit + 1)
    const rows = await this.databaseService.query<SavedItemRow[]>(`
      SELECT id, source, source_item_id, item, saved_at
      FROM discover_saved_items
      WHERE user_id = $1
        ${afterCursor}
      ORDER BY saved_at DESC, id DESC
      LIMIT $${parameters.length}
    `, parameters)
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map((row) => this.toSnapshot(row))
    return {
      items,
      nextCursor: hasMore && items.length > 0
        ? this.encodeCursor(items.at(-1) as DiscoverSavedItem)
        : null,
    }
  }

  async saveItem(userId: string, itemId: string, idempotencyKey: string) {
    const source = this.sourceFromItemId(itemId)
    const cache = await this.cacheService.read(source)
    const item = cache?.items.find((candidate) => candidate.id === itemId)
    if (!item) throw new NotFoundException({ code: 'DISCOVER_ITEM_NOT_FOUND' })
    const normalizedItem = normalizeDiscoverItem(item, source)
    const requestHash = hashToken(JSON.stringify({
      operation: 'DISCOVER_ITEM_SAVE',
      itemId,
    }))

    return this.databaseService.transaction(async (manager) => {
      await this.lockIdempotency(manager, userId, idempotencyKey)
      const stored = await this.idempotencyService.getResponse<{
        created: boolean
        savedItem: DiscoverSavedItem
      }>(manager, userId, idempotencyKey, requestHash)
      if (stored) return stored

      const inserted = await manager.query(`
        INSERT INTO discover_saved_items (
          user_id, source, source_item_id, item
        ) VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (user_id, source_item_id) DO NOTHING
        RETURNING id, source, source_item_id, item, saved_at
      `, [userId, source, itemId, JSON.stringify(normalizedItem)]) as SavedItemRow[]
      const rows = inserted.length > 0 ? inserted : await manager.query(`
        SELECT id, source, source_item_id, item, saved_at
        FROM discover_saved_items
        WHERE user_id = $1 AND source_item_id = $2
      `, [userId, itemId]) as SavedItemRow[]
      const row = rows[0]
      if (!row) throw new Error('Failed to save Discover item')
      const response = { created: inserted.length > 0, savedItem: this.toSnapshot(row) }
      if (response.created) {
        await this.analyticsService.recordSave(
          manager,
          userId,
          normalizedItem.source,
          normalizedItem.category,
        )
      }
      await this.idempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        'DISCOVER_ITEM_SAVE',
        requestHash,
        response,
      )
      return response
    })
  }

  deleteItem(userId: string, savedItemId: string, idempotencyKey: string) {
    const requestHash = hashToken(JSON.stringify({
      operation: 'DISCOVER_ITEM_DELETE',
      savedItemId,
    }))
    return this.databaseService.transaction(async (manager) => {
      await this.lockIdempotency(manager, userId, idempotencyKey)
      const stored = await this.idempotencyService.getResponse<{
        deleted: boolean
        savedItemId: string
      }>(manager, userId, idempotencyKey, requestHash)
      if (stored) return stored

      const [deletedRows] = await manager.query(`
        DELETE FROM discover_saved_items
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `, [savedItemId, userId]) as [Array<{ id: string }>, number]
      const response = { deleted: deletedRows.length > 0, savedItemId }
      await this.idempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        'DISCOVER_ITEM_DELETE',
        requestHash,
        response,
      )
      return response
    })
  }

  async findSavedItemReferences(
    userId: string,
    items: readonly DiscoverItem[],
  ): Promise<DiscoverSavedItemReference[]> {
    if (items.length === 0) return []
    const rows = await this.databaseService.query<Array<{
      id: string
      source_item_id: string
    }>>(`
      SELECT id, source_item_id
      FROM discover_saved_items
      WHERE user_id = $1 AND source_item_id = ANY($2::varchar[])
    `, [userId, items.map((item) => item.id)])
    return rows.map((row) => ({
      itemId: row.source_item_id,
      savedItemId: row.id,
    }))
  }

  private sourceFromItemId(itemId: string) {
    if (!DISCOVER_ITEM_ID_PATTERN.test(itemId)) {
      throw new NotFoundException({ code: 'DISCOVER_ITEM_NOT_FOUND' })
    }
    const source = itemId.slice(0, itemId.indexOf(':')) as DiscoverSource
    if (!DISCOVER_SOURCES.includes(source)) {
      throw new NotFoundException({ code: 'DISCOVER_ITEM_NOT_FOUND' })
    }
    return source
  }

  private toSnapshot(row: SavedItemRow): DiscoverSavedItem {
    return {
      id: row.id,
      item: normalizeDiscoverItem(row.item as DiscoverItem, row.source),
      savedAt: new Date(row.saved_at).toISOString(),
    }
  }

  private encodeCursor(item: DiscoverSavedItem) {
    return Buffer.from(JSON.stringify({
      version: 1,
      savedAt: item.savedAt,
      id: item.id,
    }), 'utf8').toString('base64url')
  }

  private decodeCursor(value: string): SavedItemCursor {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) validationError('cursor is invalid')
    let cursor: unknown
    try {
      cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    } catch {
      validationError('cursor is invalid')
    }
    if (
      typeof cursor !== 'object'
      || cursor === null
      || Array.isArray(cursor)
      || !('version' in cursor)
      || cursor.version !== 1
      || !('savedAt' in cursor)
      || typeof cursor.savedAt !== 'string'
      || !Number.isFinite(Date.parse(cursor.savedAt))
      || !('id' in cursor)
      || typeof cursor.id !== 'string'
      || !UUID_PATTERN.test(cursor.id)
    ) {
      validationError('cursor is invalid')
    }
    return {
      version: 1,
      savedAt: new Date(cursor.savedAt).toISOString(),
      id: cursor.id.toLowerCase(),
    }
  }

  private lockIdempotency(
    manager: EntityManager,
    userId: string,
    idempotencyKey: string,
  ) {
    return manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`AISIDEQUEST:IDEMPOTENCY:${userId}:${idempotencyKey}`],
    )
  }
}
