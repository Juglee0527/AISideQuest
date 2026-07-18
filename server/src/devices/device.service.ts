import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EntityManager } from 'typeorm'

import {
  createPkceChallenge,
  hashToken,
  safeEqual,
} from '../auth/auth-crypto'
import { ApiIdempotencyService } from '../common/idempotency/api-idempotency.service'
import type { AppEnvironment } from '../config/environment'
import { DatabaseService } from '../database/database.service'
import type {
  CompleteBrowserDeviceLinkRequestDto,
  CreateBrowserDeviceLinkRequestDto,
  CreateDeviceLinkDto,
  RedeemDeviceLinkDto,
} from './device.dto'
import type {
  BrowserDeviceLinkRequestRow,
  BrowserDeviceLinkRequestSnapshot,
  DeviceLinkPurpose,
  DeviceLinkSnapshot,
  DeviceRow,
  DeviceSnapshot,
} from './device.types'

const DEVICE_COLUMNS = `
  id,
  name,
  plugin_version,
  last_seen_at,
  expires_at,
  revoked_at,
  created_at,
  queue_depth,
  queue_oldest_age_seconds,
  dead_letter_count,
  diagnostics_reported_at
`
const DEVICE_LINK_TTL_MINUTES = 10
const BROWSER_DEVICE_LINK_TTL_MINUTES = 10
const DEVICE_TOKEN_TTL_DAYS = 90

interface DeviceLinkRow {
  id: string
  user_id: string
  device_id: string | null
  purpose: DeviceLinkPurpose
  expires_at: Date
  consumed_at: Date | null
  is_active: boolean
}

@Injectable()
export class DeviceService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly apiIdempotencyService: ApiIdempotencyService,
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  async createBrowserConnectionRequest(
    body: CreateBrowserDeviceLinkRequestDto,
    idempotencyKey: string,
  ) {
    const requestId = body.requestId.toLowerCase()
    const deviceName = body.deviceName.trim()
    const requestHash = hashToken(JSON.stringify({
      operation: 'DEVICE_LINK_REQUEST_CREATE',
      idempotencyKey,
      requestId,
      verifierChallenge: body.verifierChallenge,
      deviceTokenHash: body.deviceTokenHash,
      deviceName,
      pluginVersion: body.pluginVersion,
    }))

    return this.databaseService.transaction(async (manager) => {
      await manager.query(
        `
          INSERT INTO device_link_requests (
            id,
            request_hash,
            verifier_challenge,
            device_token_hash,
            device_name,
            plugin_version,
            expires_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            clock_timestamp() + interval '${BROWSER_DEVICE_LINK_TTL_MINUTES} minutes'
          )
          ON CONFLICT (id) DO NOTHING
        `,
        [
          requestId,
          requestHash,
          body.verifierChallenge,
          body.deviceTokenHash,
          deviceName,
          body.pluginVersion,
        ],
      )

      const link = await this.getBrowserRequestRow(manager, requestId)

      if (!link) {
        throw new Error('Failed to create browser device link request')
      }

      if (link.request_hash !== requestHash) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' })
      }

      return { request: this.toBrowserRequestSnapshot(link) }
    })
  }

  async getBrowserConnectionRequest(userId: string, requestId: string) {
    const rows = await this.databaseService.query<BrowserDeviceLinkRequestRow[]>(
      this.browserRequestSelect('WHERE id = $1'),
      [requestId],
    )
    const link = rows[0]

    if (!link || (link.user_id !== null && link.user_id !== userId)) {
      throw new NotFoundException({ code: 'DEVICE_LINK_REQUEST_NOT_FOUND' })
    }

    return { request: this.toBrowserRequestSnapshot(link) }
  }

  approveBrowserConnectionRequest(
    userId: string,
    requestId: string,
    idempotencyKey: string,
  ) {
    const requestHash = hashToken(JSON.stringify({
      operation: 'DEVICE_LINK_REQUEST_APPROVE',
      requestId,
    }))

    return this.databaseService.transaction(async (manager) => {
      const link = await this.getBrowserRequestRow(manager, requestId, true)

      if (!link) {
        throw new NotFoundException({ code: 'DEVICE_LINK_REQUEST_NOT_FOUND' })
      }

      if (link.user_id !== null && link.user_id !== userId) {
        throw new ConflictException({
          code: 'DEVICE_LINK_REQUEST_ALREADY_APPROVED',
        })
      }

      await this.lockUserDevices(manager, userId)

      const storedResponse = await this.apiIdempotencyService.getResponse<{
        request: BrowserDeviceLinkRequestSnapshot
        device: DeviceSnapshot
      }>(manager, userId, idempotencyKey, requestHash)

      if (storedResponse) {
        return storedResponse
      }

      let device: DeviceRow | undefined

      if (link.approved_at !== null && link.device_id !== null) {
        const devices = (await manager.query(
          `SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = $1 AND user_id = $2`,
          [link.device_id, userId],
        )) as DeviceRow[]
        device = devices[0]
      } else {
        if (!link.is_active) {
          throw new GoneException({ code: 'DEVICE_LINK_REQUEST_EXPIRED' })
        }

        const devices = (await manager.query(
          `
            INSERT INTO devices (
              user_id,
              name,
              token_hash,
              plugin_version,
              expires_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              clock_timestamp() + interval '${DEVICE_TOKEN_TTL_DAYS} days'
            )
            RETURNING ${DEVICE_COLUMNS}
          `,
          [
            userId,
            link.device_name,
            link.device_token_hash,
            link.plugin_version,
          ],
        )) as DeviceRow[]
        device = devices[0]

        if (device) {
          const approved = (await manager.query(
            `
              UPDATE device_link_requests
              SET user_id = $2,
                  device_id = $3,
                  approved_at = clock_timestamp()
              WHERE id = $1
              RETURNING approved_at
            `,
            [requestId, userId, device.id],
          )) as Array<{ approved_at: Date }>
          link.user_id = userId
          link.device_id = device.id
          link.approved_at = approved[0]?.approved_at ?? new Date()
        }
      }

      if (!device) {
        throw new Error('Failed to approve browser device link request')
      }

      const response = {
        request: this.toBrowserRequestSnapshot(link),
        device: this.toSnapshot(device),
      }

      await this.apiIdempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        'DEVICE_LINK_REQUEST_APPROVE',
        requestHash,
        response,
      )

      return response
    })
  }

  async completeBrowserConnectionRequest(
    requestId: string,
    body: CompleteBrowserDeviceLinkRequestDto,
  ) {
    const rows = await this.databaseService.query<BrowserDeviceLinkRequestRow[]>(
      this.browserRequestSelect('WHERE id = $1'),
      [requestId],
    )
    const link = rows[0]

    if (
      !link ||
      !safeEqual(createPkceChallenge(body.verifier), link.verifier_challenge)
    ) {
      throw new UnauthorizedException({ code: 'DEVICE_LINK_REQUEST_INVALID' })
    }

    if (!link.is_active) {
      throw new GoneException({ code: 'DEVICE_LINK_REQUEST_EXPIRED' })
    }

    if (link.approved_at === null || link.device_id === null) {
      return {
        request: this.toBrowserRequestSnapshot(link),
        retryAfterMs: 1_000,
      }
    }

    const devices = await this.databaseService.query<DeviceRow[]>(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = $1`,
      [link.device_id],
    )
    const device = devices[0]

    if (!device) {
      throw new UnauthorizedException({ code: 'DEVICE_LINK_REQUEST_INVALID' })
    }

    return {
      request: this.toBrowserRequestSnapshot(link),
      device: this.toSnapshot(device),
    }
  }

  createConnectionLink(
    userId: string,
    body: CreateDeviceLinkDto,
    idempotencyKey: string,
  ) {
    return this.createLink(
      userId,
      null,
      'CONNECT',
      body.code,
      idempotencyKey,
    )
  }

  createRotationLink(
    userId: string,
    deviceId: string,
    body: CreateDeviceLinkDto,
    idempotencyKey: string,
  ) {
    return this.createLink(
      userId,
      deviceId,
      'ROTATE',
      body.code,
      idempotencyKey,
    )
  }

  async redeemLink(body: RedeemDeviceLinkDto, idempotencyKey: string) {
    const normalizedCode = body.code.toLowerCase()
    const deviceName = body.deviceName.trim()
    const requestHash = hashToken(
      JSON.stringify({
        operation: 'DEVICE_LINK_REDEEM',
        code: normalizedCode,
        deviceTokenHash: hashToken(body.deviceToken),
        deviceName,
        pluginVersion: body.pluginVersion,
      }),
    )

    return this.databaseService.transaction(async (manager) => {
      const links = (await manager.query(
        `
          SELECT
            id,
            user_id,
            device_id,
            purpose,
            expires_at,
            consumed_at,
            expires_at > clock_timestamp() AS is_active
          FROM device_link_codes
          WHERE code_hash = $1
          FOR UPDATE
        `,
        [hashToken(normalizedCode)],
      )) as DeviceLinkRow[]
      const link = links[0]

      if (!link) {
        this.invalidLink()
      }

      await this.lockUserDevices(manager, link.user_id)

      const storedResponse = await this.apiIdempotencyService.getResponse<{
        device: DeviceSnapshot
      }>(manager, link.user_id, idempotencyKey, requestHash)

      if (storedResponse) {
        return storedResponse
      }

      if (link.consumed_at !== null || !link.is_active) {
        this.invalidLink()
      }

      const tokenHash = hashToken(body.deviceToken)
      let devices: DeviceRow[]

      if (link.purpose === 'CONNECT') {
        devices = (await manager.query(
          `
            INSERT INTO devices (
              user_id,
              name,
              token_hash,
              plugin_version,
              expires_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              clock_timestamp() + interval '${DEVICE_TOKEN_TTL_DAYS} days'
            )
            RETURNING ${DEVICE_COLUMNS}
          `,
          [link.user_id, deviceName, tokenHash, body.pluginVersion],
        )) as DeviceRow[]
      } else {
        devices = (await manager.query(
          `
            WITH updated_device AS (
              UPDATE devices
              SET name = $3,
                  token_hash = $4,
                  plugin_version = $5,
                  last_seen_at = NULL,
                  expires_at = clock_timestamp() + interval '${DEVICE_TOKEN_TTL_DAYS} days',
                  updated_at = clock_timestamp()
              WHERE id = $1
                AND user_id = $2
                AND revoked_at IS NULL
              RETURNING ${DEVICE_COLUMNS}
            )
            SELECT ${DEVICE_COLUMNS}
            FROM updated_device
          `,
          [
            link.device_id,
            link.user_id,
            deviceName,
            tokenHash,
            body.pluginVersion,
          ],
        )) as DeviceRow[]
      }

      const device = devices[0]

      if (!device) {
        this.invalidLink()
      }

      await manager.query(
        `
          UPDATE device_link_codes
          SET consumed_at = clock_timestamp()
          WHERE id = $1
        `,
        [link.id],
      )

      if (link.purpose === 'CONNECT') {
        await manager.query(
          `
            UPDATE device_link_codes
            SET consumed_at = clock_timestamp()
            WHERE user_id = $1
              AND purpose = 'CONNECT'
              AND consumed_at IS NULL
          `,
          [link.user_id],
        )
      }

      const response = { device: this.toSnapshot(device) }

      await this.apiIdempotencyService.storeResponse(
        manager,
        link.user_id,
        idempotencyKey,
        'DEVICE_LINK_REDEEM',
        requestHash,
        response,
      )

      return response
    })
  }

  async listDevices(userId: string) {
    const devices = await this.databaseService.query<DeviceRow[]>(
      `
        SELECT ${DEVICE_COLUMNS}
        FROM devices
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [userId],
    )

    return { items: devices.map((device) => this.toSnapshot(device)) }
  }

  revokeDevice(userId: string, deviceId: string, idempotencyKey: string) {
    const requestHash = hashToken(
      JSON.stringify({ operation: 'DEVICE_REVOKE', deviceId }),
    )

    return this.databaseService.transaction(async (manager) => {
      await this.lockUserDevices(manager, userId)

      const storedResponse = await this.apiIdempotencyService.getResponse<{
        device: DeviceSnapshot
      }>(manager, userId, idempotencyKey, requestHash)

      if (storedResponse) {
        return storedResponse
      }

      const devices = (await manager.query(
        `
          WITH updated_device AS (
            UPDATE devices
            SET revoked_at = COALESCE(revoked_at, clock_timestamp()),
                updated_at = clock_timestamp()
            WHERE id = $1 AND user_id = $2
            RETURNING ${DEVICE_COLUMNS}
          )
          SELECT ${DEVICE_COLUMNS}
          FROM updated_device
        `,
        [deviceId, userId],
      )) as DeviceRow[]
      const device = devices[0]

      if (!device) {
        throw new NotFoundException({ code: 'DEVICE_NOT_FOUND' })
      }

      const response = { device: this.toSnapshot(device) }

      await this.apiIdempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        'DEVICE_REVOKE',
        requestHash,
        response,
      )

      return response
    })
  }

  private createLink(
    userId: string,
    deviceId: string | null,
    purpose: DeviceLinkPurpose,
    code: string,
    idempotencyKey: string,
  ) {
    const normalizedCode = code.toLowerCase()
    const operation = purpose === 'CONNECT'
      ? 'DEVICE_LINK_CREATE'
      : 'DEVICE_ROTATION_LINK_CREATE'
    const requestHash = hashToken(
      JSON.stringify({ operation, deviceId, code: normalizedCode }),
    )

    return this.databaseService.transaction(async (manager) => {
      await this.lockUserDevices(manager, userId)

      const storedResponse = await this.apiIdempotencyService.getResponse<{
        link: DeviceLinkSnapshot
      }>(manager, userId, idempotencyKey, requestHash)

      if (storedResponse) {
        return storedResponse
      }

      if (deviceId !== null) {
        const devices = (await manager.query(
          `
            SELECT id
            FROM devices
            WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
          `,
          [deviceId, userId],
        )) as Array<{ id: string }>

        if (!devices[0]) {
          throw new NotFoundException({ code: 'DEVICE_NOT_FOUND' })
        }
      }

      const links = (await manager.query(
        `
          INSERT INTO device_link_codes (
            user_id,
            device_id,
            purpose,
            code_hash,
            expires_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            clock_timestamp() + interval '${DEVICE_LINK_TTL_MINUTES} minutes'
          )
          RETURNING expires_at
        `,
        [userId, deviceId, purpose, hashToken(normalizedCode)],
      )) as Array<{ expires_at: Date }>
      const link = links[0]

      if (!link) {
        throw new Error('Failed to create device link')
      }

      const response = {
        link: {
          purpose,
          deviceId,
          expiresAt: link.expires_at.toISOString(),
        },
      }

      await this.apiIdempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        operation,
        requestHash,
        response,
      )

      return response
    })
  }

  private async lockUserDevices(manager: EntityManager, userId: string) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`DEVICE:${userId}`],
    )
  }

  private browserRequestSelect(suffix: string) {
    return `
      SELECT
        id,
        request_hash,
        verifier_challenge,
        device_token_hash,
        device_name,
        plugin_version,
        user_id,
        device_id,
        expires_at,
        approved_at,
        expires_at > clock_timestamp() AS is_active
      FROM device_link_requests
      ${suffix}
    `
  }

  private async getBrowserRequestRow(
    manager: EntityManager,
    requestId: string,
    lock = false,
  ) {
    const rows = (await manager.query(
      this.browserRequestSelect(`WHERE id = $1${lock ? ' FOR UPDATE' : ''}`),
      [requestId],
    )) as BrowserDeviceLinkRequestRow[]

    return rows[0]
  }

  private toBrowserRequestSnapshot(
    link: BrowserDeviceLinkRequestRow,
  ): BrowserDeviceLinkRequestSnapshot {
    const status = link.approved_at !== null
      ? 'APPROVED'
      : link.is_active
        ? 'PENDING'
        : 'EXPIRED'
    const origin = this.configService.getOrThrow('CORS_ORIGIN')

    return {
      id: link.id,
      status,
      deviceName: link.device_name,
      pluginVersion: link.plugin_version,
      expiresAt: link.expires_at.toISOString(),
      approvedAt: link.approved_at?.toISOString() ?? null,
      verificationUrl: `${origin}/devices/connect/${link.id}`,
    }
  }

  private toSnapshot(device: DeviceRow): DeviceSnapshot {
    return {
      id: device.id,
      name: device.name,
      pluginVersion: device.plugin_version,
      lastSeenAt: device.last_seen_at?.toISOString() ?? null,
      expiresAt: device.expires_at.toISOString(),
      revokedAt: device.revoked_at?.toISOString() ?? null,
      createdAt: device.created_at.toISOString(),
      diagnostics: device.diagnostics_reported_at
        ? {
            queueDepth: device.queue_depth,
            oldestAgeSeconds: device.queue_oldest_age_seconds,
            deadLetterCount: device.dead_letter_count,
            reportedAt: device.diagnostics_reported_at.toISOString(),
          }
        : null,
    }
  }

  private invalidLink(): never {
    throw new UnauthorizedException({ code: 'DEVICE_LINK_INVALID' })
  }
}
