import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
} from 'node:fs/promises'
import { join } from 'node:path'

import { acquireFileLock } from './file-lock.mjs'

const QUEUE_FILE_NAME = 'delivery-queue.jsonl'
const DEAD_LETTER_FILE_NAME = 'dead-letter.jsonl'
const QUEUE_LOCK_FILE_NAME = 'delivery-queue.lock'
const COMPACTION_MIN_BYTES = 1024 * 1024

export const DEFAULT_QUEUE_POLICY = Object.freeze({
  maxItems: 10_000,
  maxBytes: 10 * 1024 * 1024,
  retentionMs: 48 * 60 * 60 * 1_000,
  deadLetterMaxItems: 1_000,
  deadLetterMaxBytes: 1024 * 1024,
  deadLetterRetentionMs: 7 * 24 * 60 * 60 * 1_000,
})

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function queuePaths(dataDirectory) {
  return {
    queue: join(dataDirectory, QUEUE_FILE_NAME),
    deadLetter: join(dataDirectory, DEAD_LETTER_FILE_NAME),
    lock: join(dataDirectory, QUEUE_LOCK_FILE_NAME),
  }
}

async function appendDurably(filePath, value) {
  const handle = await open(filePath, 'a', 0o600)

  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await chmod(filePath, 0o600)
  } catch {
    // Windows uses the permissions of the user-local data directory.
  }
}

async function writeAtomically(filePath, lines) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  const handle = await open(temporaryPath, 'w', 0o600)

  try {
    await handle.writeFile(
      lines.length === 0 ? '' : `${lines.map(JSON.stringify).join('\n')}\n`,
      'utf8',
    )
    await handle.sync()
  } finally {
    await handle.close()
  }

  await rename(temporaryPath, filePath)
}

function createEmptyState() {
  return {
    items: new Map(),
    nextSequence: 1,
    operationCount: 0,
    ignoredPartialLines: 0,
  }
}

function isLegacyEvent(value) {
  return isRecord(value)
    && typeof value.eventId === 'string'
    && typeof value.event === 'string'
    && typeof value.observedAt === 'string'
    && !('op' in value)
}

function applyQueueOperation(state, operation) {
  if (!isRecord(operation)) {
    return false
  }

  if (isLegacyEvent(operation)) {
    const sequence = state.nextSequence
    state.nextSequence += 1
    state.items.set(operation.eventId, {
      sequence,
      event: operation,
      enqueuedAt: operation.observedAt,
      attemptCount: 0,
      nextAttemptAt: operation.observedAt,
      authBlocked: false,
      lastFailureCode: null,
    })
    return true
  }

  switch (operation.op) {
    case 'META':
      if (Number.isSafeInteger(operation.nextSequence)) {
        state.nextSequence = Math.max(
          state.nextSequence,
          operation.nextSequence,
        )
        return true
      }
      return false
    case 'ENQUEUE':
      if (
        isRecord(operation.item)
        && typeof operation.item.event?.eventId === 'string'
        && Number.isSafeInteger(operation.item.sequence)
      ) {
        state.items.set(operation.item.event.eventId, operation.item)
        state.nextSequence = Math.max(
          state.nextSequence,
          operation.item.sequence + 1,
        )
        return true
      }
      return false
    case 'UPDATE': {
      const item = state.items.get(operation.eventId)

      if (!item || !isRecord(operation.changes)) {
        return false
      }

      state.items.set(operation.eventId, { ...item, ...operation.changes })
      return true
    }
    case 'REMOVE':
      if (typeof operation.eventId === 'string') {
        state.items.delete(operation.eventId)
        return true
      }
      return false
    default:
      return false
  }
}

async function readQueueState(queuePath) {
  const state = createEmptyState()
  let content

  try {
    content = await readFile(queuePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return state
    }
    throw error
  }

  const lines = content.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()

    if (line === '') {
      continue
    }

    try {
      const operation = JSON.parse(line)
      state.operationCount += 1

      if (!applyQueueOperation(state, operation)) {
        state.ignoredPartialLines += 1
      }
    } catch {
      state.ignoredPartialLines += 1
    }
  }

  return state
}

function queueBytes(items) {
  return items.reduce(
    (total, item) => total + Buffer.byteLength(JSON.stringify(item), 'utf8'),
    0,
  )
}

function sortedItems(state) {
  return [...state.items.values()].sort(
    (left, right) => left.sequence - right.sequence,
  )
}

async function compactQueueIfNeeded(queuePath, state) {
  let fileSize = 0

  try {
    fileSize = (await stat(queuePath)).size
  } catch {
    return
  }

  if (
    fileSize < COMPACTION_MIN_BYTES
    && state.operationCount < state.items.size * 4 + 100
    && state.ignoredPartialLines === 0
  ) {
    return
  }

  await writeAtomically(queuePath, [
    { op: 'META', nextSequence: state.nextSequence },
    ...sortedItems(state).map((item) => ({ op: 'ENQUEUE', item })),
  ])
}

async function readDeadLetters(deadLetterPath) {
  let content

  try {
    content = await readFile(deadLetterPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  }

  return content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        const value = JSON.parse(line)
        return isRecord(value) ? [value] : []
      } catch {
        return []
      }
    })
}

async function persistDeadLetters(deadLetterPath, records, policy, now) {
  const oldestAllowed = now.getTime() - policy.deadLetterRetentionMs
  const retained = records
    .filter((record) => Date.parse(record.failedAt) >= oldestAllowed)
    .slice(-policy.deadLetterMaxItems)

  while (
    retained.length > 0
    && queueBytes(retained) > policy.deadLetterMaxBytes
  ) {
    retained.shift()
  }

  await writeAtomically(deadLetterPath, retained)
}

async function pruneDeadLetters(paths, now, policy) {
  const records = await readDeadLetters(paths.deadLetter)

  if (records.length === 0) {
    return
  }

  const oldestAllowed = now.getTime() - policy.deadLetterRetentionMs
  const hasExpired = records.some(
    (record) => Date.parse(record.failedAt) < oldestAllowed,
  )
  const exceedsSize = records.length > policy.deadLetterMaxItems
    || queueBytes(records) > policy.deadLetterMaxBytes

  if (hasExpired || exceedsSize) {
    await persistDeadLetters(paths.deadLetter, records, policy, now)
  }
}

async function addDeadLetter(paths, item, reason, now, policy) {
  const records = await readDeadLetters(paths.deadLetter)
  records.push({
    schemaVersion: 1,
    failedAt: now.toISOString(),
    reason,
    sequence: item.sequence,
    attemptCount: item.attemptCount,
    event: item.event,
  })
  await persistDeadLetters(paths.deadLetter, records, policy, now)
}

async function appendOperation(paths, state, operation) {
  await appendDurably(paths.queue, operation)
  applyQueueOperation(state, operation)
  state.operationCount += 1
}

async function pruneExpiredItems(paths, state, now, policy) {
  const oldestAllowed = now.getTime() - policy.retentionMs

  for (const item of sortedItems(state)) {
    if (Date.parse(item.enqueuedAt) >= oldestAllowed) {
      continue
    }

    if (item.event.event !== 'Heartbeat') {
      await addDeadLetter(paths, item, 'RETENTION_EXPIRED', now, policy)
    }

    await appendOperation(paths, state, {
      op: 'REMOVE',
      eventId: item.event.eventId,
    })
  }
}

async function removeOldestHeartbeat(paths, state) {
  const heartbeat = sortedItems(state).find(
    (item) => item.event.event === 'Heartbeat',
  )

  if (!heartbeat) {
    return false
  }

  await appendOperation(paths, state, {
    op: 'REMOVE',
    eventId: heartbeat.event.eventId,
  })
  return true
}

async function withQueueLock(dataDirectory, work) {
  await mkdir(dataDirectory, { recursive: true })
  const paths = queuePaths(dataDirectory)
  const release = await acquireFileLock(paths.lock)

  try {
    return await work(paths)
  } finally {
    await release()
  }
}

export async function enqueueEvent(
  event,
  dataDirectory,
  {
    now = new Date(),
    policy = DEFAULT_QUEUE_POLICY,
  } = {},
) {
  return withQueueLock(dataDirectory, async (paths) => {
    const state = await readQueueState(paths.queue)

    if (state.items.has(event.eventId)) {
      return { queued: true, duplicate: true }
    }

    await pruneDeadLetters(paths, now, policy)
    await pruneExpiredItems(paths, state, now, policy)

    if (event.event === 'Heartbeat') {
      const lastItem = sortedItems(state).at(-1)

      if (
        lastItem?.event.event === 'Heartbeat'
        && lastItem.event.turnKey === event.turnKey
      ) {
        await appendOperation(paths, state, {
          op: 'REMOVE',
          eventId: lastItem.event.eventId,
        })
      }
    }

    const item = {
      sequence: state.nextSequence,
      event,
      enqueuedAt: now.toISOString(),
      attemptCount: 0,
      nextAttemptAt: now.toISOString(),
      authBlocked: false,
      lastFailureCode: null,
    }
    const exceedsLimit = () => {
      const items = [...sortedItems(state), item]
      return items.length > policy.maxItems
        || queueBytes(items) > policy.maxBytes
    }

    while (exceedsLimit() && await removeOldestHeartbeat(paths, state)) {
      // Heartbeats do not carry lifecycle transitions and are pruned first.
    }

    if (exceedsLimit()) {
      await addDeadLetter(
        paths,
        item,
        'QUEUE_CAPACITY_EXCEEDED',
        now,
        policy,
      )
      return { queued: false, duplicate: false }
    }

    await appendOperation(paths, state, { op: 'ENQUEUE', item })
    await appendOperation(paths, state, {
      op: 'META',
      nextSequence: state.nextSequence,
    })
    await compactQueueIfNeeded(paths.queue, state)

    return { queued: true, duplicate: false, sequence: item.sequence }
  })
}

export async function readQueueSnapshot(
  dataDirectory,
  {
    now = new Date(),
    policy = DEFAULT_QUEUE_POLICY,
  } = {},
) {
  return withQueueLock(dataDirectory, async (paths) => {
    const state = await readQueueState(paths.queue)
    await pruneExpiredItems(paths, state, now, policy)
    await pruneDeadLetters(paths, now, policy)
    await compactQueueIfNeeded(paths.queue, state)
    return sortedItems(state).map((item) => structuredClone(item))
  })
}

export async function readDeadLetterSnapshot(
  dataDirectory,
  {
    now = new Date(),
    policy = DEFAULT_QUEUE_POLICY,
  } = {},
) {
  return withQueueLock(dataDirectory, async (paths) => {
    await pruneDeadLetters(paths, now, policy)
    return readDeadLetters(paths.deadLetter)
  })
}

export async function acknowledgeEvent(eventId, dataDirectory) {
  return withQueueLock(dataDirectory, async (paths) => {
    const state = await readQueueState(paths.queue)

    if (!state.items.has(eventId)) {
      return false
    }

    await appendOperation(paths, state, { op: 'REMOVE', eventId })
    await compactQueueIfNeeded(paths.queue, state)
    return true
  })
}

export async function updateQueuedEvent(eventId, changes, dataDirectory) {
  return withQueueLock(dataDirectory, async (paths) => {
    const state = await readQueueState(paths.queue)

    if (!state.items.has(eventId)) {
      return false
    }

    await appendOperation(paths, state, {
      op: 'UPDATE',
      eventId,
      changes,
    })
    await compactQueueIfNeeded(paths.queue, state)
    return true
  })
}

export async function deadLetterEvent(
  eventId,
  reason,
  dataDirectory,
  {
    now = new Date(),
    policy = DEFAULT_QUEUE_POLICY,
  } = {},
) {
  return withQueueLock(dataDirectory, async (paths) => {
    const state = await readQueueState(paths.queue)
    const item = state.items.get(eventId)

    if (!item) {
      return false
    }

    await addDeadLetter(paths, item, reason, now, policy)
    await appendOperation(paths, state, { op: 'REMOVE', eventId })
    await compactQueueIfNeeded(paths.queue, state)
    return true
  })
}

export async function unblockAuthBlockedEvents(dataDirectory, now = new Date()) {
  return withQueueLock(dataDirectory, async (paths) => {
    const state = await readQueueState(paths.queue)
    let changed = 0

    for (const item of sortedItems(state)) {
      if (!item.authBlocked) {
        continue
      }

      await appendOperation(paths, state, {
        op: 'UPDATE',
        eventId: item.event.eventId,
        changes: {
          authBlocked: false,
          nextAttemptAt: now.toISOString(),
          lastFailureCode: null,
        },
      })
      changed += 1
    }

    await compactQueueIfNeeded(paths.queue, state)
    return changed
  })
}

export function resolveQueueFilePath(dataDirectory) {
  return queuePaths(dataDirectory).queue
}
