import { Injectable, UnauthorizedException } from '@nestjs/common'

import { hashToken } from '../auth/auth-crypto'
import { DatabaseService } from '../database/database.service'
import type { DeviceAuthContext } from './session.types'

interface DeviceRow {
  device_id: string
  user_id: string
}

@Injectable()
export class DeviceAuthService {
  constructor(private readonly databaseService: DatabaseService) {}

  async authenticate(token: string): Promise<DeviceAuthContext> {
    if (token.length > 256) {
      throw new UnauthorizedException({ code: 'DEVICE_AUTH_REQUIRED' })
    }

    const devices = await this.databaseService.query<DeviceRow[]>(
      `
        WITH authenticated_device AS (
          UPDATE devices
          SET last_seen_at = clock_timestamp(),
              updated_at = clock_timestamp()
          FROM users
          WHERE devices.user_id = users.id
            AND devices.token_hash = $1
            AND devices.revoked_at IS NULL
            AND devices.expires_at > now()
            AND users.deleted_at IS NULL
          RETURNING devices.id AS device_id, devices.user_id
        )
        SELECT device_id, user_id
        FROM authenticated_device
      `,
      [hashToken(token)],
    )
    const device = devices[0]

    if (!device) {
      throw new UnauthorizedException({ code: 'DEVICE_AUTH_REQUIRED' })
    }

    return {
      deviceId: device.device_id,
      userId: device.user_id,
    }
  }
}
