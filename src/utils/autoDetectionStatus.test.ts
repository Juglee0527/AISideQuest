import { describe, expect, it } from 'vitest'

import type { Device } from '../types/device'
import { getAutoDetectionSummary } from './autoDetectionStatus'

const CURRENT_TIME = Date.parse('2026-07-16T03:00:00.000Z')

function createDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: crypto.randomUUID(),
    name: 'Windows Codex',
    pluginVersion: '0.1.0',
    lastSeenAt: null,
    expiresAt: '2026-10-14T03:00:00.000Z',
    revokedAt: null,
    createdAt: '2026-07-16T02:00:00.000Z',
    ...overrides,
  }
}

describe('getAutoDetectionSummary', () => {
  it('uses manual mode when no active device exists', () => {
    const summary = getAutoDetectionSummary([
      createDevice({ revokedAt: '2026-07-16T02:30:00.000Z' }),
      createDevice({ expiresAt: '2026-07-16T02:59:59.999Z' }),
    ], CURRENT_TIME)

    expect(summary).toEqual({
      status: 'MANUAL',
      activeDeviceCount: 0,
      lastEventAt: null,
    })
  })

  it('waits for the first lifecycle event after device connection', () => {
    const summary = getAutoDetectionSummary([createDevice()], CURRENT_TIME)

    expect(summary).toEqual({
      status: 'READY',
      activeDeviceCount: 1,
      lastEventAt: null,
    })
  })

  it('selects the latest valid event from active devices only', () => {
    const summary = getAutoDetectionSummary([
      createDevice({ lastSeenAt: '2026-07-16T02:30:00.000Z' }),
      createDevice({ lastSeenAt: '2026-07-16T02:50:00.000Z' }),
      createDevice({
        lastSeenAt: '2026-07-16T02:59:00.000Z',
        revokedAt: '2026-07-16T02:59:30.000Z',
      }),
    ], CURRENT_TIME)

    expect(summary).toEqual({
      status: 'RECEIVING',
      activeDeviceCount: 2,
      lastEventAt: '2026-07-16T02:50:00.000Z',
    })
  })
})
