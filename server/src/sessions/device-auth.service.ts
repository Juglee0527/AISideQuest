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
        SELECT devices.id AS device_id, devices.user_id
        FROM devices
        JOIN users ON users.id = devices.user_id
        WHERE devices.token_hash = $1
          AND devices.revoked_at IS NULL
          AND devices.expires_at > now()
          AND users.deleted_at IS NULL
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
