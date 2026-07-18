import {
  ApiClientError,
  createMutationHeaders,
  requestApi,
} from './apiClient'
import type {
  BrowserDeviceLinkRequest,
  Device,
  DeviceLink,
} from '../types/device'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function invalidDeviceResponse(): never {
  throw new ApiClientError(
    0,
    'INVALID_API_RESPONSE',
    '기기 응답 형식을 확인할 수 없습니다.',
  )
}

function parseDevice(value: unknown): Device {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !(value.pluginVersion === null || typeof value.pluginVersion === 'string') ||
    !(value.lastSeenAt === null || isIsoDate(value.lastSeenAt)) ||
    !isIsoDate(value.expiresAt) ||
    !(value.revokedAt === null || isIsoDate(value.revokedAt)) ||
    !isIsoDate(value.createdAt)
  ) {
    return invalidDeviceResponse()
  }

  return {
    id: value.id,
    name: value.name,
    pluginVersion: value.pluginVersion,
    lastSeenAt: value.lastSeenAt,
    expiresAt: value.expiresAt,
    revokedAt: value.revokedAt,
    createdAt: value.createdAt,
  }
}

function parseDeviceList(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return invalidDeviceResponse()
  }

  return { items: value.items.map(parseDevice) }
}

function parseDeviceLink(value: unknown): DeviceLink {
  if (
    !isRecord(value) ||
    (value.purpose !== 'CONNECT' && value.purpose !== 'ROTATE') ||
    !(value.deviceId === null || typeof value.deviceId === 'string') ||
    !isIsoDate(value.expiresAt)
  ) {
    return invalidDeviceResponse()
  }

  return {
    purpose: value.purpose,
    deviceId: value.deviceId,
    expiresAt: value.expiresAt,
  }
}

function parseLinkResponse(value: unknown) {
  if (!isRecord(value)) {
    return invalidDeviceResponse()
  }

  return { link: parseDeviceLink(value.link) }
}

function parseDeviceResponse(value: unknown) {
  if (!isRecord(value)) {
    return invalidDeviceResponse()
  }

  return { device: parseDevice(value.device) }
}

function parseBrowserDeviceLinkRequest(
  value: unknown,
): BrowserDeviceLinkRequest {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !['PENDING', 'APPROVED', 'EXPIRED'].includes(String(value.status)) ||
    typeof value.deviceName !== 'string' ||
    typeof value.pluginVersion !== 'string' ||
    !isIsoDate(value.expiresAt) ||
    !(value.approvedAt === null || isIsoDate(value.approvedAt)) ||
    typeof value.verificationUrl !== 'string'
  ) {
    return invalidDeviceResponse()
  }

  return {
    id: value.id,
    status: value.status as BrowserDeviceLinkRequest['status'],
    deviceName: value.deviceName,
    pluginVersion: value.pluginVersion,
    expiresAt: value.expiresAt,
    approvedAt: value.approvedAt,
    verificationUrl: value.verificationUrl,
  }
}

function parseBrowserLinkResponse(value: unknown) {
  if (!isRecord(value)) {
    return invalidDeviceResponse()
  }

  return { request: parseBrowserDeviceLinkRequest(value.request) }
}

function parseBrowserApprovalResponse(value: unknown) {
  if (!isRecord(value)) {
    return invalidDeviceResponse()
  }

  return {
    request: parseBrowserDeviceLinkRequest(value.request),
    device: parseDevice(value.device),
  }
}

export function getDevices(signal?: AbortSignal) {
  return requestApi('/devices', parseDeviceList, { signal })
}

export function getBrowserDeviceLinkRequest(
  requestId: string,
  signal?: AbortSignal,
) {
  return requestApi(
    `/device-link-requests/${encodeURIComponent(requestId)}`,
    parseBrowserLinkResponse,
    { signal },
  )
}

export function approveBrowserDeviceLinkRequest(requestId: string) {
  return requestApi(
    `/device-link-requests/${encodeURIComponent(requestId)}/approve`,
    parseBrowserApprovalResponse,
    {
      method: 'POST',
      headers: createMutationHeaders(),
    },
  )
}

export function createDeviceLink(code: string) {
  return requestApi('/device-links', parseLinkResponse, {
    method: 'POST',
    headers: {
      ...createMutationHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  })
}

export function createDeviceRotationLink(deviceId: string, code: string) {
  return requestApi(
    `/devices/${encodeURIComponent(deviceId)}/rotation-links`,
    parseLinkResponse,
    {
      method: 'POST',
      headers: {
        ...createMutationHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    },
  )
}

export function revokeDevice(deviceId: string) {
  return requestApi(
    `/devices/${encodeURIComponent(deviceId)}/revoke`,
    parseDeviceResponse,
    {
      method: 'POST',
      headers: createMutationHeaders(),
    },
  )
}
