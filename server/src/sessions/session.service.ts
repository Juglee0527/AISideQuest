import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { EntityManager } from 'typeorm'

import { hashToken } from '../auth/auth-crypto'
import { DatabaseService } from '../database/database.service'
import type {
  IntegrationEventDto,
  SessionEndOutcome,
  SessionHistoryQueryDto,
} from './session.dto'
import { parseUuid, validationError } from './session-input'
import type {
  DeviceAuthContext,
  IntegrationEventName,
  IntegrationEventResponse,
  IntegrationProcessingResult,
  SessionRow,
  SessionSnapshot,
  SessionStatus,
  TerminalReason,
} from './session.types'

const SESSION_COLUMNS = `
  id,
  user_id,
  provider,
  status,
  origin,
  external_session_key,
  external_turn_key,
  started_at,
  ended_at,
  last_activity_at,
  terminal_reason,
  timing_quality,
  version
`

const ACTIVE_STATUSES: readonly SessionStatus[] = [
  'RUNNING',
  'WAITING_FOR_USER',
]

const INTEGRATION_EVENTS = new Set<IntegrationEventName>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'Heartbeat',
])

const MAX_OBSERVED_AT_FUTURE_MS = 5 * 60 * 1_000
const DEFERRED_EVENT_TTL_MS = 24 * 60 * 60 * 1_000

interface StoredIdempotencyRow {
  request_hash: string
  response_body: unknown
}

interface StoredIntegrationEventRow {
  ai_session_id: string | null
  processing_result: IntegrationProcessingResult
  request_hash: string
  response_body: unknown
}

interface DeferredEventRow {
  id: string
  event_id: string
  event: IntegrationEventName
  received_at: Date
}

interface DatabaseTimeRow {
  current_time: Date
}

interface SessionCursor {
  startedAt: string
  id: string
}

interface AppliedEvent {
  result: IntegrationProcessingResult
  session: SessionRow | null
}

@Injectable()
export class SessionService {
  constructor(private readonly databaseService: DatabaseService) {}

  async startManualSession(userId: string, idempotencyKey: string) {
    const requestHash = hashToken(
      JSON.stringify({ operation: 'SESSION_MANUAL_START' }),
    )

    return this.databaseService.transaction(async (manager) => {
      await this.lockUserSessions(manager, userId)

      const storedResponse = await this.getIdempotentResponse<{
        created: boolean
        session: SessionSnapshot
      }>(manager, userId, idempotencyKey, requestHash)

      if (storedResponse) {
        return storedResponse
      }

      const currentTime = await this.getDatabaseTime(manager)
      const activeSession = await this.findActiveSession(manager, userId, true)
      let created = false
      let session = activeSession

      if (!session) {
        const sessions = (await manager.query(
          `
            INSERT INTO ai_sessions (
              user_id, provider, status, origin,
              started_at, last_activity_at
            )
            VALUES ($1, 'CODEX', 'RUNNING', 'MANUAL', $2, $2)
            RETURNING ${SESSION_COLUMNS}
          `,
          [userId, currentTime],
        )) as SessionRow[]
        session = sessions[0]
        created = true
      }

      if (!session) {
        throw new Error('Failed to create manual AI session')
      }

      const response = {
        created,
        session: this.toSnapshot(session, currentTime),
      }

      await this.storeIdempotentResponse(
        manager,
        userId,
        idempotencyKey,
        'SESSION_MANUAL_START',
        requestHash,
        response,
      )

      return response
    })
  }

  async endSession(
    userId: string,
    sessionId: string,
    outcome: SessionEndOutcome,
    idempotencyKey: string,
  ) {
    const requestHash = hashToken(
      JSON.stringify({
        operation: 'SESSION_END',
        sessionId,
        outcome,
      }),
    )

    return this.databaseService.transaction(async (manager) => {
      await this.lockUserSessions(manager, userId)

      const storedResponse = await this.getIdempotentResponse<{
        session: SessionSnapshot
      }>(manager, userId, idempotencyKey, requestHash)

      if (storedResponse) {
        return storedResponse
      }

      let session = await this.findSessionById(
        manager,
        userId,
        sessionId,
        true,
      )

      if (!session) {
        throw new NotFoundException({ code: 'SESSION_NOT_FOUND' })
      }

      const currentTime = await this.getDatabaseTime(manager)

      if (this.isActive(session.status)) {
        const terminal = this.getManualTerminalState(outcome)
        const [sessions] = (await manager.query(
          `
            UPDATE ai_sessions
            SET status = $3,
                ended_at = GREATEST($4::timestamptz, started_at),
                last_activity_at = GREATEST(last_activity_at, $4::timestamptz),
                terminal_reason = $5,
                version = version + 1,
                updated_at = $4
            WHERE id = $1 AND user_id = $2
            RETURNING ${SESSION_COLUMNS}
          `,
          [
            sessionId,
            userId,
            terminal.status,
            currentTime,
            terminal.reason,
          ],
        )) as [SessionRow[], number]
        session = sessions[0]
      }

      if (!session) {
        throw new Error('Failed to end AI session')
      }

      const response = {
        session: this.toSnapshot(session, currentTime),
      }

      await this.storeIdempotentResponse(
        manager,
        userId,
        idempotencyKey,
        'SESSION_END',
        requestHash,
        response,
      )

      return response
    })
  }

  async getActiveSession(userId: string) {
    const sessions = await this.databaseService.query<SessionRow[]>(
      `
        SELECT ${SESSION_COLUMNS}
        FROM ai_sessions
        WHERE user_id = $1
          AND status IN ('RUNNING', 'WAITING_FOR_USER')
      `,
      [userId],
    )
    const session = sessions[0]

    return session ? this.toSnapshot(session, new Date()) : null
  }

  async getSessionHistory(userId: string, query: SessionHistoryQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null
    const rows = await this.databaseService.query<SessionRow[]>(
      `
        SELECT ${SESSION_COLUMNS}
        FROM ai_sessions
        WHERE user_id = $1
          AND ($2::varchar IS NULL OR status = $2)
          AND (
            $3::timestamptz IS NULL
            OR (started_at, id) < ($3::timestamptz, $4::uuid)
          )
        ORDER BY started_at DESC, id DESC
        LIMIT $5
      `,
      [
        userId,
        query.status ?? null,
        cursor?.startedAt ?? null,
        cursor?.id ?? null,
        query.limit + 1,
      ],
    )
    const hasNextPage = rows.length > query.limit
    const pageRows = rows.slice(0, query.limit)
    const lastRow = pageRows.at(-1)
    const currentTime = new Date()

    return {
      items: pageRows.map((row) => this.toSnapshot(row, currentTime)),
      nextCursor:
        hasNextPage && lastRow
          ? this.encodeCursor({
              startedAt: lastRow.started_at.toISOString(),
              id: lastRow.id,
            })
          : null,
    }
  }

  async processIntegrationEvent(
    deviceAuth: DeviceAuthContext,
    dto: IntegrationEventDto,
  ): Promise<IntegrationEventResponse> {
    const event = this.validateIntegrationEvent(dto)
    const observedAt = new Date(dto.observedAt)

    if (observedAt.getTime() > Date.now() + MAX_OBSERVED_AT_FUTURE_MS) {
      validationError('observedAt cannot be more than 5 minutes in the future')
    }

    const requestHash = hashToken(
      JSON.stringify({
        schemaVersion: dto.schemaVersion,
        eventId: dto.eventId,
        provider: dto.provider,
        event,
        sessionKey: dto.sessionKey,
        turnKey: dto.turnKey ?? null,
        observedAt: dto.observedAt,
      }),
    )

    return this.databaseService.transaction(async (manager) => {
      await this.lockUserSessions(manager, deviceAuth.userId)
      const receivedAt = await this.getDatabaseTime(manager)

      const [, updatedDevices] = (await manager.query(
        `
          UPDATE devices
          SET last_seen_at = $2, updated_at = $2
          WHERE id = $1
            AND user_id = $3
            AND revoked_at IS NULL
            AND expires_at > $2
            AND EXISTS (
              SELECT 1
              FROM users
              WHERE users.id = devices.user_id
                AND users.deleted_at IS NULL
            )
        `,
        [deviceAuth.deviceId, receivedAt, deviceAuth.userId],
      )) as [unknown[], number]

      if (updatedDevices !== 1) {
        throw new UnauthorizedException({ code: 'DEVICE_AUTH_REQUIRED' })
      }

      const storedEvents = (await manager.query(
        `
          SELECT
            ai_session_id,
            processing_result,
            request_hash,
            response_body
          FROM integration_events
          WHERE device_id = $1 AND event_id = $2
        `,
        [deviceAuth.deviceId, dto.eventId],
      )) as StoredIntegrationEventRow[]
      const storedEvent = storedEvents[0]

      if (storedEvent) {
        if (storedEvent.request_hash !== requestHash) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' })
        }

        if (this.isIntegrationEventResponse(storedEvent.response_body)) {
          return storedEvent.response_body
        }

        const storedSession = storedEvent.ai_session_id
          ? await this.findSessionById(
              manager,
              deviceAuth.userId,
              storedEvent.ai_session_id,
              false,
            )
          : null

        return {
          eventId: dto.eventId,
          result: storedEvent.processing_result,
          session: storedSession
            ? this.toSnapshot(storedSession, receivedAt)
            : null,
        }
      }

      let applied = await this.applyIntegrationEvent(
        manager,
        deviceAuth.userId,
        event,
        dto.sessionKey,
        dto.turnKey ?? null,
        receivedAt,
      )

      if (
        event === 'UserPromptSubmit' &&
        dto.turnKey &&
        applied.session
      ) {
        applied = {
          ...applied,
          session: await this.reprocessDeferredEvents(
            manager,
            deviceAuth.userId,
            dto.turnKey,
            applied.session,
            receivedAt,
          ),
        }
      }

      const response: IntegrationEventResponse = {
        eventId: dto.eventId,
        result: applied.result,
        session: applied.session
          ? this.toSnapshot(applied.session, receivedAt)
          : null,
      }

      await manager.query(
        `
          INSERT INTO integration_events (
            event_id,
            device_id,
            user_id,
            ai_session_id,
            provider,
            event,
            external_session_key,
            external_turn_key,
            observed_at,
            received_at,
            processing_result,
            request_hash,
            response_body
          )
          VALUES (
            $1, $2, $3, $4, 'CODEX', $5, $6, $7,
            $8, $9, $10, $11, $12::jsonb
          )
        `,
        [
          dto.eventId,
          deviceAuth.deviceId,
          deviceAuth.userId,
          applied.session?.id ?? null,
          event,
          dto.sessionKey,
          dto.turnKey ?? null,
          observedAt,
          receivedAt,
          applied.result,
          requestHash,
          JSON.stringify(response),
        ],
      )

      return response
    })
  }

  private async applyIntegrationEvent(
    manager: EntityManager,
    userId: string,
    event: IntegrationEventName,
    sessionKey: string,
    turnKey: string | null,
    receivedAt: Date,
  ): Promise<AppliedEvent> {
    if (event === 'SessionStart') {
      return { result: 'APPLIED', session: null }
    }

    if (!turnKey) {
      validationError('turnKey is required for turn events')
    }

    if (event === 'UserPromptSubmit') {
      return this.applyTurnStart(
        manager,
        userId,
        sessionKey,
        turnKey,
        receivedAt,
      )
    }

    const session = await this.findSessionByTurn(
      manager,
      userId,
      turnKey,
      true,
    )

    if (!session) {
      return { result: 'DEFERRED', session: null }
    }

    return this.applySessionEvent(manager, session, event, receivedAt)
  }

  private async applyTurnStart(
    manager: EntityManager,
    userId: string,
    sessionKey: string,
    turnKey: string,
    receivedAt: Date,
  ): Promise<AppliedEvent> {
    const sameTurnSession = await this.findSessionByTurn(
      manager,
      userId,
      turnKey,
      true,
    )

    if (sameTurnSession) {
      return {
        result: this.isActive(sameTurnSession.status)
          ? 'DUPLICATE'
          : 'IGNORED_TERMINAL',
        session: sameTurnSession,
      }
    }

    const activeSession = await this.findActiveSession(manager, userId, true)

    if (activeSession && activeSession.external_turn_key === null) {
      const [sessions] = (await manager.query(
        `
          UPDATE ai_sessions
          SET external_session_key = $3,
              external_turn_key = $4,
              last_activity_at = GREATEST(last_activity_at, $5::timestamptz),
              version = version + 1,
              updated_at = $5
          WHERE id = $1 AND user_id = $2
          RETURNING ${SESSION_COLUMNS}
        `,
        [activeSession.id, userId, sessionKey, turnKey, receivedAt],
      )) as [SessionRow[], number]

      return { result: 'APPLIED', session: sessions[0] ?? null }
    }

    if (activeSession) {
      await manager.query(
        `
          UPDATE ai_sessions
          SET status = 'ABANDONED',
              ended_at = GREATEST($3::timestamptz, started_at),
              last_activity_at = GREATEST(last_activity_at, $3::timestamptz),
              terminal_reason = 'SUPERSEDED_BY_NEW_TURN',
              version = version + 1,
              updated_at = $3
          WHERE id = $1 AND user_id = $2
        `,
        [activeSession.id, userId, receivedAt],
      )
    }

    const sessions = (await manager.query(
      `
        INSERT INTO ai_sessions (
          user_id,
          provider,
          status,
          origin,
          external_session_key,
          external_turn_key,
          started_at,
          last_activity_at
        )
        VALUES ($1, 'CODEX', 'RUNNING', 'HOOK', $2, $3, $4, $4)
        RETURNING ${SESSION_COLUMNS}
      `,
      [userId, sessionKey, turnKey, receivedAt],
    )) as SessionRow[]

    return { result: 'APPLIED', session: sessions[0] ?? null }
  }

  private async applySessionEvent(
    manager: EntityManager,
    session: SessionRow,
    event: Exclude<
      IntegrationEventName,
      'SessionStart' | 'UserPromptSubmit'
    >,
    receivedAt: Date,
  ): Promise<AppliedEvent> {
    if (!this.isActive(session.status)) {
      if (
        event === 'Stop' &&
        session.status === 'ABANDONED' &&
        session.ended_at &&
        receivedAt.getTime() - session.ended_at.getTime() <=
          DEFERRED_EVENT_TTL_MS
      ) {
        const [sessions] = (await manager.query(
          `
            UPDATE ai_sessions
            SET status = 'COMPLETED',
                terminal_reason = 'RECOVERED_LATE_STOP',
                timing_quality = 'DEGRADED',
                version = version + 1,
                updated_at = $3
            WHERE id = $1 AND user_id = $2
            RETURNING ${SESSION_COLUMNS}
          `,
          [session.id, session.user_id, receivedAt],
        )) as [SessionRow[], number]

        return { result: 'APPLIED', session: sessions[0] ?? null }
      }

      return { result: 'IGNORED_TERMINAL', session }
    }

    const effectiveAt =
      receivedAt.getTime() < session.started_at.getTime()
        ? session.started_at
        : receivedAt
    const degraded = receivedAt.getTime() < session.started_at.getTime()
    const nextStatus = this.getEventStatus(session.status, event)
    const isStop = event === 'Stop'
    const [sessions] = (await manager.query(
      `
        UPDATE ai_sessions
        SET status = $3,
            ended_at = CASE
              WHEN $4::boolean THEN $5::timestamptz
              ELSE NULL
            END,
            last_activity_at = GREATEST(last_activity_at, $5::timestamptz),
            terminal_reason = CASE WHEN $4::boolean THEN 'HOOK_STOP' ELSE NULL END,
            timing_quality = CASE
              WHEN $6::boolean THEN 'DEGRADED'
              ELSE timing_quality
            END,
            version = version + 1,
            updated_at = $5
        WHERE id = $1 AND user_id = $2
        RETURNING ${SESSION_COLUMNS}
      `,
      [
        session.id,
        session.user_id,
        nextStatus,
        isStop,
        effectiveAt,
        degraded,
      ],
    )) as [SessionRow[], number]

    return { result: 'APPLIED', session: sessions[0] ?? null }
  }

  private async reprocessDeferredEvents(
    manager: EntityManager,
    userId: string,
    turnKey: string,
    initialSession: SessionRow,
    startReceivedAt: Date,
  ) {
    const deferredEvents = (await manager.query(
      `
        SELECT id, event_id, event, received_at
        FROM integration_events
        WHERE user_id = $1
          AND provider = 'CODEX'
          AND external_turn_key = $2
          AND processing_result = 'DEFERRED'
        ORDER BY received_at, id
        FOR UPDATE
      `,
      [userId, turnKey],
    )) as DeferredEventRow[]
    let session = initialSession

    for (const deferredEvent of deferredEvents) {
      let applied: AppliedEvent

      if (
        startReceivedAt.getTime() - deferredEvent.received_at.getTime() >
        DEFERRED_EVENT_TTL_MS
      ) {
        applied = { result: 'IGNORED_ORPHAN', session: null }
      } else {
        applied = await this.applySessionEvent(
          manager,
          session,
          deferredEvent.event as Exclude<
            IntegrationEventName,
            'SessionStart' | 'UserPromptSubmit'
          >,
          deferredEvent.received_at,
        )
        session = applied.session ?? session
      }

      const response: IntegrationEventResponse = {
        eventId: deferredEvent.event_id,
        result: applied.result,
        session: applied.session
          ? this.toSnapshot(applied.session, startReceivedAt)
          : null,
      }

      await manager.query(
        `
          UPDATE integration_events
          SET ai_session_id = $2,
              processing_result = $3,
              response_body = $4::jsonb
          WHERE id = $1
        `,
        [
          deferredEvent.id,
          applied.session?.id ?? null,
          applied.result,
          JSON.stringify(response),
        ],
      )
    }

    return session
  }

  private validateIntegrationEvent(dto: IntegrationEventDto) {
    if (!INTEGRATION_EVENTS.has(dto.event as IntegrationEventName)) {
      throw new UnprocessableEntityException({ code: 'UNSUPPORTED_EVENT' })
    }

    if (dto.event !== 'SessionStart' && !dto.turnKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: ['turnKey is required for turn events'],
      })
    }

    return dto.event as IntegrationEventName
  }

  private getEventStatus(
    currentStatus: SessionStatus,
    event: Exclude<
      IntegrationEventName,
      'SessionStart' | 'UserPromptSubmit'
    >,
  ): SessionStatus {
    switch (event) {
      case 'PermissionRequest':
        return 'WAITING_FOR_USER'
      case 'PostToolUse':
        return 'RUNNING'
      case 'Stop':
        return 'COMPLETED'
      case 'PreToolUse':
      case 'Heartbeat':
        return currentStatus
    }
  }

  private getManualTerminalState(outcome: SessionEndOutcome): {
    status: SessionStatus
    reason: TerminalReason
  } {
    switch (outcome) {
      case 'COMPLETED':
        return { status: 'COMPLETED', reason: 'MANUAL_COMPLETED' }
      case 'FAILED':
        return { status: 'FAILED', reason: 'MANUAL_FAILED' }
      case 'ABANDONED':
        return { status: 'ABANDONED', reason: 'MANUAL_CANCELLED' }
    }
  }

  private async findActiveSession(
    manager: EntityManager,
    userId: string,
    lock: boolean,
  ) {
    const rows = (await manager.query(
      `
        SELECT ${SESSION_COLUMNS}
        FROM ai_sessions
        WHERE user_id = $1
          AND status IN ('RUNNING', 'WAITING_FOR_USER')
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [userId],
    )) as SessionRow[]

    return rows[0] ?? null
  }

  private async findSessionById(
    manager: EntityManager,
    userId: string,
    sessionId: string,
    lock: boolean,
  ) {
    const rows = (await manager.query(
      `
        SELECT ${SESSION_COLUMNS}
        FROM ai_sessions
        WHERE id = $1 AND user_id = $2
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [sessionId, userId],
    )) as SessionRow[]

    return rows[0] ?? null
  }

  private async findSessionByTurn(
    manager: EntityManager,
    userId: string,
    turnKey: string,
    lock: boolean,
  ) {
    const rows = (await manager.query(
      `
        SELECT ${SESSION_COLUMNS}
        FROM ai_sessions
        WHERE user_id = $1
          AND provider = 'CODEX'
          AND external_turn_key = $2
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [userId, turnKey],
    )) as SessionRow[]

    return rows[0] ?? null
  }

  private async lockUserSessions(manager: EntityManager, userId: string) {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`AI_SESSION:${userId}`],
    )
  }

  private async getDatabaseTime(manager: EntityManager) {
    const rows = (await manager.query(
      'SELECT clock_timestamp() AS current_time',
    )) as DatabaseTimeRow[]
    const currentTime = rows[0]?.current_time

    if (!currentTime) {
      throw new Error('Failed to read database time')
    }

    return currentTime
  }

  private async getIdempotentResponse<T>(
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

  private async storeIdempotentResponse(
    manager: EntityManager,
    userId: string,
    idempotencyKey: string,
    operation: 'SESSION_MANUAL_START' | 'SESSION_END',
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

  private toSnapshot(session: SessionRow, currentTime: Date): SessionSnapshot {
    const endTime = session.ended_at ?? currentTime

    return {
      id: session.id,
      provider: session.provider,
      status: session.status,
      origin: session.origin,
      autoLinked: session.external_turn_key !== null,
      startedAt: session.started_at.toISOString(),
      endedAt: session.ended_at?.toISOString() ?? null,
      lastActivityAt: session.last_activity_at.toISOString(),
      durationMs: Math.max(
        0,
        endTime.getTime() - session.started_at.getTime(),
      ),
      terminalReason: session.terminal_reason,
      timingQuality: session.timing_quality,
      version: session.version,
    }
  }

  private isActive(status: SessionStatus) {
    return ACTIVE_STATUSES.includes(status)
  }

  private encodeCursor(cursor: SessionCursor) {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(cursor: string): SessionCursor {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
      validationError('cursor is invalid')
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
      validationError('cursor is invalid')
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !('startedAt' in parsed) ||
      typeof parsed.startedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.startedAt)) ||
      !('id' in parsed) ||
      typeof parsed.id !== 'string'
    ) {
      validationError('cursor is invalid')
    }

    return {
      startedAt: new Date(parsed.startedAt).toISOString(),
      id: parseUuid(parsed.id, 'cursor id'),
    }
  }

  private isIntegrationEventResponse(
    value: unknown,
  ): value is IntegrationEventResponse {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      'eventId' in value &&
      typeof value.eventId === 'string' &&
      'result' in value &&
      typeof value.result === 'string' &&
      'session' in value
    )
  }
}
