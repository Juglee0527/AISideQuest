function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class ApiRequestError extends Error {
  constructor(message, { status = null, code = 'NETWORK_ERROR', retryAfterMs = null } = {}) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  const seconds = Number(value)

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000)
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null
}

export function normalizeApiUrl(value) {
  const apiUrl = new URL(value)

  if (apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:') {
    throw new Error('API URL은 http 또는 https 주소여야 합니다.')
  }

  return apiUrl.toString().replace(/\/+$/, '')
}

export async function postApi(
  path,
  body,
  headers,
  apiUrl,
  fetchImpl = fetch,
  signal,
) {
  let response

  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    throw new ApiRequestError(
      error instanceof Error ? error.message : 'AISideQuest API 네트워크 요청에 실패했습니다.',
    )
  }
  let payload

  try {
    payload = await response.json()
  } catch {
    throw new ApiRequestError(
      `AISideQuest API가 JSON이 아닌 응답을 반환했습니다. (${response.status})`,
      {
        status: response.status,
        code: 'INVALID_RESPONSE',
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      },
    )
  }

  if (!response.ok) {
    const code = isRecord(payload) && isRecord(payload.error)
      && typeof payload.error.code === 'string'
      ? payload.error.code
      : 'HTTP_ERROR'

    throw new ApiRequestError(
      `AISideQuest API 요청에 실패했습니다. (${response.status} ${code})`,
      {
        status: response.status,
        code,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      },
    )
  }

  if (!isRecord(payload) || !('data' in payload)) {
    throw new Error('AISideQuest API 응답 형식이 올바르지 않습니다.')
  }

  return payload.data
}
