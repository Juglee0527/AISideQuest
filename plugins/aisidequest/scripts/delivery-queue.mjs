import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ApiRequestError } from './api-client.mjs'
import { resolveDataDirectory } from './event-recorder.mjs'
import { sendIntegrationEvent } from './event-sender.mjs'

const QUEUE_FILE = 'delivery-queue.jsonl'
const STATE_FILE = 'delivery-state.json'
const DIAGNOSTIC_FILE = 'delivery-diagnostic.json'
const DEAD_LETTER_FILE = 'dead-letter.jsonl'
const LOCK_DIRECTORY = 'delivery-queue.lock'
const MAX_QUEUE_ITEMS = 10_000
const MAX_QUEUE_BYTES = 10 * 1024 * 1024
const MAX_QUEUE_AGE_MS = 48 * 60 * 60 * 1_000
const MAX_DEAD_LETTER_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_RETRY_AGE_MS = 24 * 60 * 60 * 1_000
const MAX_RETRY_ATTEMPTS = 300
const MAX_BACKOFF_MS = 5 * 60 * 1_000

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function paths(environment) {
  const directory = resolveDataDirectory(environment)
  return {
    directory,
    queue: join(directory, QUEUE_FILE),
    state: join(directory, STATE_FILE),
    diagnostic: join(directory, DIAGNOSTIC_FILE),
    deadLetter: join(directory, DEAD_LETTER_FILE),
    lock: join(directory, LOCK_DIRECTORY),
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function atomicWrite(path, value) {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

async function acquireLock(path, { staleMs = 30_000, waitMs = 2_000 } = {}) {
  const deadline = Date.now() + waitMs

  while (Date.now() <= deadline) {
    try {
      await mkdir(path)
      return async () => rm(path, { recursive: true, force: true })
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      try {
        const lockStat = await stat(path)
        if (Date.now() - lockStat.mtimeMs > staleMs) {
          await rm(path, { recursive: true, force: true })
          continue
        }
      } catch {
        continue
      }

      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  return null
}

async function withLock(queuePaths, work) {
  await mkdir(queuePaths.directory, { recursive: true })
  const release = await acquireLock(queuePaths.lock)

  if (release === null) {
    throw new Error('AISideQuest delivery queue is busy')
  }

  try {
    return await work()
  } finally {
    await release()
  }
}

async function readQueue(queuePaths) {
  let text = ''

  try {
    text = await readFile(queuePaths.queue, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  const items = new Map()
  const corrupt = []

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue
    }

    try {
      const record = JSON.parse(line)
      if (isRecord(record) && isRecord(record.item) && Number.isSafeInteger(record.item.sequence)) {
        if (record.type === 'EVENT' || record.type === 'REPLACE') {
          items.set(record.item.sequence, record.item)
        }
      } else {
        corrupt.push(line)
      }
    } catch {
      corrupt.push(line)
    }
  }

  return { text, items: [...items.values()].sort((a, b) => a.sequence - b.sequence), corrupt }
}

async function appendDeadLetter(queuePaths, item, reason, now) {
  await appendFile(queuePaths.deadLetter, `${JSON.stringify({ item, reason, failedAt: now.toISOString() })}\n`, 'utf8')
}

async function writeDiagnostic(queuePaths, patch) {
  const current = await readJson(queuePaths.diagnostic, {})
  const diagnostic = {
    schemaVersion: 1,
    status: 'READY',
    queueDepth: 0,
    oldestAgeMs: 0,
    deadLetterCount: 0,
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  if (diagnostic.status === 'READY') {
    delete diagnostic.lastErrorCode
  }

  await atomicWrite(queuePaths.diagnostic, diagnostic)
}

async function compactDeadLetters(queuePaths, now) {
  let text
  try {
    text = await readFile(queuePaths.deadLetter, 'utf8')
  } catch {
    return 0
  }

  const retained = text.split('\n').filter((line) => {
    if (line.trim() === '') return false
    try {
      const record = JSON.parse(line)
      return Date.parse(record.failedAt) >= now.getTime() - MAX_DEAD_LETTER_AGE_MS
    } catch {
      return false
    }
  })
  await writeFile(queuePaths.deadLetter, retained.length ? `${retained.join('\n')}\n` : '', 'utf8')
  return retained.length
}

async function rewriteQueue(queuePaths, items) {
  const body = items.map((item) => JSON.stringify({ type: 'EVENT', item })).join('\n')
  const temporaryPath = `${queuePaths.queue}.${process.pid}.tmp`
  await writeFile(temporaryPath, body ? `${body}\n` : '', 'utf8')
  await rename(temporaryPath, queuePaths.queue)
}

async function normalizeQueue(queuePaths, queue, state, now) {
  let items = queue.items.filter((item) => item.sequence > (state.ackedSequence ?? 0))
  let changed = queue.corrupt.length > 0

  for (const line of queue.corrupt) {
    await appendDeadLetter(
      queuePaths,
      { recordHash: createHash('sha256').update(line).digest('hex') },
      'CORRUPT_QUEUE_RECORD',
      now,
    )
  }

  const fresh = []
  for (const item of items) {
    const expired = Date.parse(item.enqueuedAt) < now.getTime() - MAX_QUEUE_AGE_MS
    if (expired) {
      await appendDeadLetter(
        queuePaths,
        item,
        item.event?.event === 'Heartbeat' ? 'EXPIRED_HEARTBEAT' : 'QUEUE_MAX_AGE_EXCEEDED',
        now,
      )
      changed = true
    } else {
      fresh.push(item)
    }
  }
  items = fresh

  const encodedSize = () => Buffer.byteLength(
    items.map((item) => JSON.stringify({ type: 'EVENT', item })).join('\n'),
    'utf8',
  )

  if (items.length > MAX_QUEUE_ITEMS || encodedSize() > MAX_QUEUE_BYTES) {
    while (items.length > MAX_QUEUE_ITEMS || encodedSize() > MAX_QUEUE_BYTES) {
      const heartbeatIndex = items.findIndex((item) => item.event?.event === 'Heartbeat')
      const [dropped] = items.splice(heartbeatIndex >= 0 ? heartbeatIndex : 0, 1)
      await appendDeadLetter(queuePaths, dropped, 'QUEUE_CAPACITY_EXCEEDED', now)
      changed = true
    }
  }

  if (changed || queue.text.length > MAX_QUEUE_BYTES) {
    await rewriteQueue(queuePaths, items)
  }

  return items
}

export async function enqueueEvent(event, { environment = process.env, now = new Date() } = {}) {
  const queuePaths = paths(environment)

  return withLock(queuePaths, async () => {
    const state = await readJson(queuePaths.state, { nextSequence: 1, ackedSequence: 0, retries: {} })
    const queue = await readQueue(queuePaths)
    const degraded = queue.corrupt.length > 0
      || queue.text.length > MAX_QUEUE_BYTES
      || queue.items.length > MAX_QUEUE_ITEMS
      || queue.items.some((item) => (
        item.event?.event !== 'Heartbeat'
        && Date.parse(item.enqueuedAt) < now.getTime() - MAX_QUEUE_AGE_MS
      ))
    const items = await normalizeQueue(queuePaths, queue, state, now)
    const last = items.at(-1)

    if (
      event.event === 'Heartbeat' &&
      last?.event?.event === 'Heartbeat' &&
      last.event.turnKey === event.turnKey
    ) {
      const replacement = { ...last, event: { ...event, sequence: last.sequence }, enqueuedAt: now.toISOString() }
      await appendFile(queuePaths.queue, `${JSON.stringify({ type: 'REPLACE', item: replacement })}\n`, 'utf8')
      return replacement.event
    }

    const sequence = Math.max(1, state.nextSequence ?? 1)
    const queuedEvent = { ...event, sequence }
    const item = { sequence, event: queuedEvent, enqueuedAt: now.toISOString() }
    await appendFile(queuePaths.queue, `${JSON.stringify({ type: 'EVENT', item })}\n`, 'utf8')
    await atomicWrite(queuePaths.state, { ...state, nextSequence: sequence + 1 })
    await writeDiagnostic(queuePaths, {
      status: degraded ? 'DEGRADED' : 'QUEUED',
      queueDepth: items.length + 1,
      oldestAgeMs: items.length ? Math.max(0, now - new Date(items[0].enqueuedAt)) : 0,
      ...(degraded ? { lastErrorCode: 'QUEUE_RECORDS_DEAD_LETTERED' } : {}),
    })
    return queuedEvent
  })
}

function retryable(error) {
  return !(error instanceof ApiRequestError) || error.status === null || error.status === 408 || error.status === 429 || error.status >= 500
}

function backoff(attempt, random = Math.random) {
  const ceiling = Math.min(MAX_BACKOFF_MS, 1_000 * (2 ** Math.min(attempt - 1, 18)))
  return Math.floor(random() * ceiling)
}

export async function processNextEvent({
  environment = process.env,
  fetchImpl = fetch,
  now = new Date(),
  random = Math.random,
} = {}) {
  const queuePaths = paths(environment)
  const prepared = await withLock(queuePaths, async () => {
    const state = await readJson(queuePaths.state, { nextSequence: 1, ackedSequence: 0, retries: {} })
    const queue = await readQueue(queuePaths)
    const items = await normalizeQueue(queuePaths, queue, state, now)
    const item = items[0]
    const deadLetterCount = await compactDeadLetters(queuePaths, now)

    if (!item) {
      await writeDiagnostic(queuePaths, { status: 'READY', queueDepth: 0, oldestAgeMs: 0, deadLetterCount })
      return { done: { status: 'EMPTY', waitMs: 0 } }
    }

    const retry = state.retries?.[item.sequence]
    if (retry?.nextAttemptAt && Date.parse(retry.nextAttemptAt) > now.getTime()) {
      return { done: { status: 'WAIT', waitMs: Date.parse(retry.nextAttemptAt) - now.getTime() } }
    }

    return { item, retry, deadLetterCount }
  })

  if (prepared.done) return prepared.done

  const { item, retry, deadLetterCount } = prepared

  try {
    await sendIntegrationEvent(item.event, { environment, fetchImpl })

    return withLock(queuePaths, async () => {
      const state = await readJson(queuePaths.state, { nextSequence: 1, ackedSequence: 0, retries: {} })
      if ((state.ackedSequence ?? 0) >= item.sequence) {
        return { status: 'DELIVERED', waitMs: 0 }
      }

      const retries = { ...state.retries }
      delete retries[item.sequence]
      const queue = await readQueue(queuePaths)
      const remaining = queue.items.filter((queued) => queued.sequence > item.sequence)
      await atomicWrite(queuePaths.state, { ...state, ackedSequence: item.sequence, retries })
      if (remaining.length === 0 || queue.text.length > 256 * 1024) {
        await rewriteQueue(queuePaths, remaining)
      }
      await writeDiagnostic(queuePaths, {
        status: 'READY',
        queueDepth: remaining.length,
        oldestAgeMs: remaining.length ? Math.max(0, now - new Date(remaining[0].enqueuedAt)) : 0,
        lastDeliveredAt: now.toISOString(),
        deadLetterCount,
      })
      return { status: 'DELIVERED', waitMs: 0 }
    })
  } catch (error) {
    return withLock(queuePaths, async () => {
      const state = await readJson(queuePaths.state, { nextSequence: 1, ackedSequence: 0, retries: {} })
      const queue = await readQueue(queuePaths)
      const items = queue.items.filter((queued) => queued.sequence > (state.ackedSequence ?? 0))

      if ((state.ackedSequence ?? 0) >= item.sequence) {
        return { status: 'DELIVERED', waitMs: 0 }
      }

      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
        await writeDiagnostic(queuePaths, { status: 'AUTH_BLOCKED', queueDepth: items.length, lastErrorCode: error.code })
        return { status: 'AUTH_BLOCKED', waitMs: 0 }
      }

      const previous = retry ?? { attempts: 0, firstAttemptAt: now.toISOString() }
      const attempts = previous.attempts + 1
      const exhausted = attempts >= MAX_RETRY_ATTEMPTS || Date.parse(previous.firstAttemptAt) <= now.getTime() - MAX_RETRY_AGE_MS

      if (!retryable(error) || exhausted) {
        await appendDeadLetter(queuePaths, item, exhausted ? 'RETRY_EXHAUSTED' : 'PERMANENT_HTTP_ERROR', now)
        const retries = { ...state.retries }
        delete retries[item.sequence]
        await atomicWrite(queuePaths.state, { ...state, ackedSequence: item.sequence, retries })
        await writeDiagnostic(queuePaths, {
          status: 'DEGRADED',
          queueDepth: items.length - 1,
          deadLetterCount: deadLetterCount + 1,
          lastErrorCode: error.code ?? 'DELIVERY_FAILED',
        })
        return { status: 'DEAD_LETTERED', waitMs: 0 }
      }

      const waitMs = error instanceof ApiRequestError && error.retryAfterMs !== null
        ? Math.min(MAX_BACKOFF_MS, error.retryAfterMs)
        : backoff(attempts, random)
      const retries = {
        ...state.retries,
        [item.sequence]: {
          attempts,
          firstAttemptAt: previous.firstAttemptAt,
          nextAttemptAt: new Date(now.getTime() + waitMs).toISOString(),
        },
      }
      await atomicWrite(queuePaths.state, { ...state, retries })
      await writeDiagnostic(queuePaths, { status: 'RETRYING', queueDepth: items.length, lastErrorCode: error.code ?? 'NETWORK_ERROR' })
      return { status: 'WAIT', waitMs }
    })
  }
}

export async function readDeliveryDiagnostic(environment = process.env) {
  return readJson(paths(environment).diagnostic, null)
}
