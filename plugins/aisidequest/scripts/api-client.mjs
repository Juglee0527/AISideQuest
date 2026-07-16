function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  const response = await fetchImpl(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  })
  let payload

  try {
    payload = await response.json()
  } catch {
    throw new Error(`AISideQuest API가 JSON이 아닌 응답을 반환했습니다. (${response.status})`)
  }

  if (!response.ok) {
    const code = isRecord(payload) && isRecord(payload.error)
      && typeof payload.error.code === 'string'
      ? payload.error.code
      : 'HTTP_ERROR'

    throw new Error(`AISideQuest API 요청에 실패했습니다. (${response.status} ${code})`)
  }

  if (!isRecord(payload) || !('data' in payload)) {
    throw new Error('AISideQuest API 응답 형식이 올바르지 않습니다.')
  }

  return payload.data
}
