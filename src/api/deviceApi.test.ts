import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  approveBrowserDeviceLinkRequest,
  createDeviceLink,
  getBrowserDeviceLinkRequest,
  getDevices,
  revokeDevice,
} from './deviceApi'

const serverTime = '2026-07-16T00:00:00.000Z'
const device = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  name: 'Windows Codex',
  pluginVersion: '0.1.0',
  lastSeenAt: null,
  expiresAt: '2026-10-14T00:00:00.000Z',
  revokedAt: null,
  createdAt: serverTime,
}

function response(data: unknown) {
  return new Response(JSON.stringify({
    data,
    meta: { serverTime },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('device API client', () => {
  beforeEach(() => {
    document.cookie = 'aisidequest_csrf=csrf-token; path=/'
  })

  it('parses the device list contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [device] })))

    const result = await getDevices()

    expect(result.data.items).toEqual([device])
  })

  it('sends a browser-generated code with CSRF and idempotency', async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => response({
        link: {
          purpose: 'CONNECT',
          deviceId: null,
          expiresAt: '2026-07-16T00:10:00.000Z',
        },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const code = '123e4567-e89b-42d3-a456-426614174001'

    await createDeviceLink(code)

    const [url, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(url).toBe('http://localhost:3000/api/v1/device-links')
    expect(JSON.parse(String(init?.body))).toEqual({ code })
    expect(headers.get('x-csrf-token')).toBe('csrf-token')
    expect(headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('revokes with an empty request body', async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => response({
        device: { ...device, revokedAt: serverTime },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await revokeDevice(device.id)

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  it('loads and approves a browser device link request', async () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174010'
    const linkRequest = {
      id: requestId,
      status: 'PENDING',
      deviceName: 'Browser Codex',
      pluginVersion: '0.2.0',
      expiresAt: '2026-07-16T00:10:00.000Z',
      approvedAt: null,
      verificationUrl: `http://localhost:5173/devices/connect/${requestId}`,
    }
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => response(init?.method === 'POST'
      ? {
          request: {
            ...linkRequest,
            status: 'APPROVED',
            approvedAt: serverTime,
          },
          device,
        }
      : { request: linkRequest }))
    vi.stubGlobal('fetch', fetchMock)

    const loaded = await getBrowserDeviceLinkRequest(requestId)
    const approved = await approveBrowserDeviceLinkRequest(requestId)

    expect(loaded.data.request).toEqual(linkRequest)
    expect(approved.data.request.status).toBe('APPROVED')
    const [approvalUrl, approvalInit] = fetchMock.mock.calls[1]
    expect(approvalUrl).toBe(
      `http://localhost:3000/api/v1/device-link-requests/${requestId}/approve`,
    )
    expect(approvalInit?.body).toBeUndefined()
    expect(new Headers(approvalInit?.headers).get('x-csrf-token')).toBe('csrf-token')
  })
})
