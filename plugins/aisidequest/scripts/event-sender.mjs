import { postApi } from './api-client.mjs'
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
  const config = await readDeviceConfig(environment)
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
