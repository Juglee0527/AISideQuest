export interface Device {
  id: string
  name: string
  pluginVersion: string | null
  lastSeenAt: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export interface DeviceLink {
  purpose: 'CONNECT' | 'ROTATE'
  deviceId: string | null
  expiresAt: string
}

export interface BrowserDeviceLinkRequest {
  id: string
  status: 'PENDING' | 'APPROVED' | 'EXPIRED'
  deviceName: string
  pluginVersion: string
  expiresAt: string
  approvedAt: string | null
  verificationUrl: string
}
