import type { Device } from '../types/device'

export type AutoDetectionStatus = 'MANUAL' | 'READY' | 'RECEIVING'

export interface AutoDetectionSummary {
  status: AutoDetectionStatus
  activeDeviceCount: number
  lastEventAt: string | null
}

export function getAutoDetectionSummary(
  devices: Device[],
  currentTime = Date.now(),
): AutoDetectionSummary {
  const activeDevices = devices.filter((device) => (
    device.revokedAt === null && Date.parse(device.expiresAt) > currentTime
  ))
  const lastEventAt = activeDevices.reduce<string | null>((latest, device) => {
    if (device.lastSeenAt === null) {
      return latest
    }

    return latest === null || Date.parse(device.lastSeenAt) > Date.parse(latest)
      ? device.lastSeenAt
      : latest
  }, null)

  if (activeDevices.length === 0) {
    return { status: 'MANUAL', activeDeviceCount: 0, lastEventAt: null }
  }

  return {
    status: lastEventAt === null ? 'READY' : 'RECEIVING',
    activeDeviceCount: activeDevices.length,
    lastEventAt,
  }
}
