export type DeviceLinkPurpose = 'CONNECT' | 'ROTATE'

export interface DeviceRow {
  id: string
  name: string
  plugin_version: string | null
  last_seen_at: Date | null
  expires_at: Date
  revoked_at: Date | null
  created_at: Date
}

export interface DeviceSnapshot {
  id: string
  name: string
  pluginVersion: string | null
  lastSeenAt: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export interface DeviceLinkSnapshot {
  purpose: DeviceLinkPurpose
  deviceId: string | null
  expiresAt: string
}
