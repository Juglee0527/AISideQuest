interface ApiSuccessEnvelope<T> {
  data: T
  meta: {
    serverTime: string
  }
}

interface ApiErrorPayload {
  code?: unknown
  message?: unknown
}

interface ApiErrorEnvelope {
  error?: ApiErrorPayload
  meta?: {
    serverTime?: unknown
  }
}

export interface ApiResult<T> {
  data: T
  serverTime: string
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isServerTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function parseSuccessEnvelope<T>(
  value: unknown,
  parseData: (data: unknown) => T,
): ApiSuccessEnvelope<T> {
  if (
    !isRecord(value) ||
    !('data' in value) ||
    !isRecord(value.meta) ||
    !isServerTime(value.meta.serverTime)
  ) {
    throw new ApiClientError(
      0,
      'INVALID_API_RESPONSE',
      '서버 응답 형식을 확인할 수 없습니다.',
    )
  }

  return {
    data: parseData(value.data),
    meta: {
      serverTime: value.meta.serverTime,
    },
  }
}

function parseError(response: Response, value: unknown) {
  const envelope = isRecord(value) ? (value as ApiErrorEnvelope) : null
  const code = typeof envelope?.error?.code === 'string'
    ? envelope.error.code
    : 'HTTP_ERROR'
  const message = typeof envelope?.error?.message === 'string'
    ? envelope.error.message
    : '서버 요청을 처리하지 못했습니다.'

  return new ApiClientError(response.status, code, message)
}

function getCookie(name: string) {
  if (typeof document === 'undefined') {
    return null
  }

  for (const part of document.cookie.split(';')) {
    const separatorIndex = part.indexOf('=')

    if (separatorIndex < 0) {
      continue
    }

    const cookieName = part.slice(0, separatorIndex).trim()

    if (cookieName === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1))
    }
  }

  return null
}

function getCsrfToken() {
  const token = getCookie('__Host-aisidequest_csrf')
    ?? getCookie('aisidequest_csrf')

  if (token === null || token === '') {
    throw new ApiClientError(
      401,
      'AUTH_REQUIRED',
      '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.',
    )
  }

  return token
}

export function createMutationHeaders(idempotencyKey = crypto.randomUUID()) {
  return {
    'Idempotency-Key': idempotencyKey,
    'x-csrf-token': getCsrfToken(),
  }
}

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

export const API_BASE_URL = (
  configuredApiBaseUrl === undefined || configuredApiBaseUrl === ''
    ? 'http://localhost:3000/api/v1'
    : configuredApiBaseUrl
).replace(/\/+$/, '')

export function getGithubLoginUrl() {
  return `${API_BASE_URL}/auth/github`
}

export async function requestApi<T>(
  path: string,
  parseData: (data: unknown) => T,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiClientError(0, 'REQUEST_ABORTED', '요청이 취소되었습니다.')
    }

    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    )
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    throw new ApiClientError(
      response.status,
      'INVALID_API_RESPONSE',
      '서버 응답을 읽을 수 없습니다.',
    )
  }

  if (!response.ok) {
    throw parseError(response, payload)
  }

  const envelope = parseSuccessEnvelope(payload, parseData)

  return {
    data: envelope.data,
    serverTime: envelope.meta.serverTime,
  }
}
