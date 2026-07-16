import { join } from 'node:path'

import { ApiRequestError } from './api-client.mjs'
import { DeviceConfigError } from './device-config.mjs'
import {
  acknowledgeEvent,
  deadLetterEvent,
  readQueueSnapshot,
  updateQueuedEvent,
} from './durable-event-queue.mjs'
import { sendIntegrationEvent } from './event-sender.mjs'
import { tryAcquireProcessLock } from './file-lock.mjs'
import {
  enqueueDueHeartbeat,
  readHeartbeatState,
} from './heartbeat-state.mjs'

const WORKER_LOCK_FILE = 'delivery-worker.lock'
const RETRY_INITIAL_MS = 1_000
const RETRY_MAX_MS = 5 * 60 * 1_000
const RETRY_MAX_ATTEMPTS = 300
const RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1_000
const MAX_WORKER_SLEEP_MS = 1_000
const ACK_RESULTS = new Set([
  'APPLIED',
  'DUPLICATE',
  'DEFERRED',
  'IGNORED_TERMINAL',
  'IGNORED_ORPHAN',
])

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function calculateBackoffMs(attemptCount, random = Math.random) {
  const exponent = Math.max(0, Math.min(30, attemptCount - 1))
  const ceiling = Math.min(
    RETRY_MAX_MS,
    RETRY_INITIAL_MS * (2 ** exponent),
  )
  return Math.floor(random() * (ceiling + 1))
}

export function classifyDeliveryError(error) {
  if (error instanceof DeviceConfigError) {
    return { kind: 'AUTH_BLOCKED', code: 'DEVICE_CONFIG_REQUIRED' }
  }

  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return { kind: 'AUTH_BLOCKED', code: error.code }
    }

    if (
      error.status === 408
      || error.status === 429
      || error.status >= 500
    ) {
      return {
        kind: 'RETRY',
        code: error.code,
        retryAfterMs: error.retryAfterMs,
      }
    }

    return { kind: 'PERMANENT', code: error.code }
  }

  if (error?.name === 'AbortError' || error instanceof TypeError) {
    return { kind: 'RETRY', code: 'NETWORK_ERROR', retryAfterMs: null }
  }

  return { kind: 'RETRY', code: 'DELIVERY_ERROR', retryAfterMs: null }
}

function validateAcknowledgement(response, eventId) {
  if (
    typeof response !== 'object'
    || response === null
    || response.eventId !== eventId
    || !ACK_RESULTS.has(response.result)
  ) {
    throw new ApiRequestError(
      'AISideQuest integration event 응답 형식이 올바르지 않습니다.',
      { status: 422, code: 'INVALID_ACK_RESPONSE' },
    )
  }
}

export async function deliverNextQueuedEvent(
  dataDirectory,
  {
    environment = process.env,
    fetchImpl = fetch,
    now = new Date(),
    random = Math.random,
  } = {},
) {
  const [item] = await readQueueSnapshot(dataDirectory, { now })

  if (!item) {
    return { status: 'EMPTY', waitMs: null }
  }

  if (item.authBlocked) {
    return { status: 'AUTH_BLOCKED', waitMs: null }
  }

  const nextAttemptAt = Date.parse(item.nextAttemptAt)

  if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now.getTime()) {
    return {
      status: 'WAITING',
      waitMs: nextAttemptAt - now.getTime(),
    }
  }

  try {
    const response = await sendIntegrationEvent(item.event, {
      environment,
      fetchImpl,
    })
    validateAcknowledgement(response, item.event.eventId)
    await acknowledgeEvent(item.event.eventId, dataDirectory)
    return { status: 'DELIVERED', waitMs: 0 }
  } catch (error) {
    const failure = classifyDeliveryError(error)

    if (failure.kind === 'AUTH_BLOCKED') {
      await updateQueuedEvent(
        item.event.eventId,
        {
          authBlocked: true,
          lastFailureCode: failure.code,
        },
        dataDirectory,
      )
      return { status: 'AUTH_BLOCKED', waitMs: null }
    }

    if (failure.kind === 'PERMANENT') {
      await deadLetterEvent(
        item.event.eventId,
        failure.code,
        dataDirectory,
        { now },
      )
      return { status: 'DEAD_LETTERED', waitMs: 0 }
    }

    const attemptCount = item.attemptCount + 1
    const retryAge = now.getTime() - Date.parse(item.enqueuedAt)

    if (
      attemptCount >= RETRY_MAX_ATTEMPTS
      || retryAge >= RETRY_MAX_AGE_MS
    ) {
      await deadLetterEvent(
        item.event.eventId,
        'RETRY_EXHAUSTED',
        dataDirectory,
        { now },
      )
      return { status: 'DEAD_LETTERED', waitMs: 0 }
    }

    const waitMs = failure.retryAfterMs === null
      ? calculateBackoffMs(attemptCount, random)
      : Math.min(RETRY_MAX_MS, failure.retryAfterMs)
    await updateQueuedEvent(
      item.event.eventId,
      {
        attemptCount,
        nextAttemptAt: new Date(now.getTime() + waitMs).toISOString(),
        lastFailureCode: failure.code,
      },
      dataDirectory,
    )
    return { status: 'RETRY_SCHEDULED', waitMs }
  }
}

function nextWorkerDelay(delivery, heartbeat, now) {
  const candidates = [MAX_WORKER_SLEEP_MS]

  if (typeof delivery.waitMs === 'number') {
    candidates.push(Math.max(0, delivery.waitMs))
  }

  if (heartbeat.nextHeartbeatAt) {
    candidates.push(
      Math.max(0, Date.parse(heartbeat.nextHeartbeatAt) - now.getTime()),
    )
  }

  return Math.min(...candidates)
}

export async function runDeliveryWorker(
  dataDirectory,
  {
    environment = process.env,
    fetchImpl = fetch,
    now = () => new Date(),
    sleepImpl = sleep,
  } = {},
) {
  const release = await tryAcquireProcessLock(
    join(dataDirectory, WORKER_LOCK_FILE),
  )

  if (!release) {
    return { acquired: false }
  }

  try {
    while (true) {
      const currentTime = now()
      const heartbeat = await enqueueDueHeartbeat(dataDirectory, {
        now: currentTime,
      })
      const delivery = await deliverNextQueuedEvent(dataDirectory, {
        environment,
        fetchImpl,
        now: currentTime,
      })

      if (
        delivery.status === 'DELIVERED'
        || delivery.status === 'DEAD_LETTERED'
      ) {
        continue
      }

      if (delivery.status === 'AUTH_BLOCKED') {
        return { acquired: true, stopped: 'AUTH_BLOCKED' }
      }

      const heartbeatState = heartbeat.active
        ? heartbeat
        : await readHeartbeatState(dataDirectory)

      if (delivery.status === 'EMPTY' && !heartbeatState) {
        return { acquired: true, stopped: 'IDLE' }
      }

      await sleepImpl(nextWorkerDelay(
        delivery,
        heartbeat.active
          ? heartbeat
          : { nextHeartbeatAt: heartbeatState?.nextHeartbeatAt ?? null },
        currentTime,
      ))
    }
  } finally {
    await release()
  }
}
