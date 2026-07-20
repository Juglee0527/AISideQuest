import { ApiRequestError, postApi } from './api-client.mjs'
import { readDeviceConfig } from './device-config.mjs'

const DEFAULT_DELIVERY_TIMEOUT_MS = 3_000

export async function sendIntegrationEvent(
  event,
  {
    environment = process.env,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_DELIVERY_TIMEOUT_MS,
  } = {},
) {
  let config
  try {
    config = await readDeviceConfig(environment)
  } catch (error) {
    throw new ApiRequestError(
      error instanceof Error ? error.message : 'AISideQuest 기기 연결 정보가 없습니다.',
      { status: 401, code: 'DEVICE_NOT_CONNECTED' },
    )
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await postApi(
      '/integration-events',
      event,
      {
        Authorization: `Bearer ${config.deviceToken}`,
        'Idempotency-Key': event.eventId,
      },
      config.apiUrl,
      fetchImpl,
      controller.signal,
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function trySendIntegrationEvent(event, options) {
  try {
    return {
      sent: true,
      response: await sendIntegrationEvent(event, options),
    }
  } catch {
    return { sent: false, response: null }
  }
}
