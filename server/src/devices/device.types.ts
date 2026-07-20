export type DeviceLinkPurpose = 'CONNECT' | 'ROTATE'

export interface DeviceRow {
  id: string
  name: string
  plugin_version: string | null
  last_seen_at: Date | null
  expires_at: Date
  revoked_at: Date | null
  created_at: Date
  queue_depth: number
  queue_oldest_age_seconds: number
  dead_letter_count: number
  diagnostics_reported_at: Date | null
}

export interface DeviceSnapshot {
  id: string
  name: string
  pluginVersion: string | null
  lastSeenAt: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
  diagnostics: {
    queueDepth: number
    oldestAgeSeconds: number
    deadLetterCount: number
    reportedAt: string
  } | null
}

export interface DeviceLinkSnapshot {
  purpose: DeviceLinkPurpose
  deviceId: string | null
  expiresAt: string
}

export type BrowserDeviceLinkRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'EXPIRED'

export interface BrowserDeviceLinkRequestRow {
  id: string
  request_hash: string
  verifier_challenge: string
  device_token_hash: string
  device_name: string
  plugin_version: string
  user_id: string | null
  device_id: string | null
  expires_at: Date
  approved_at: Date | null
  is_active: boolean
}

export interface BrowserDeviceLinkRequestSnapshot {
  id: string
  status: BrowserDeviceLinkRequestStatus
  deviceName: string
  pluginVersion: string
  expiresAt: string
  approvedAt: string | null
  verificationUrl: string
}
