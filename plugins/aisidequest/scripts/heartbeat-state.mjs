import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { enqueueEvent } from './durable-event-queue.mjs'
import { acquireFileLock, isProcessAlive } from './file-lock.mjs'

const HEARTBEAT_STATE_FILE = 'heartbeat-state.json'
const HEARTBEAT_LOCK_FILE = 'heartbeat-state.lock'

export const HEARTBEAT_INTERVAL_MS = 30_000
export const HEARTBEAT_FALLBACK_LEASE_MS = 120_000
export const HEARTBEAT_MAX_TURN_MS = 12 * 60 * 60 * 1_000

function statePaths(dataDirectory) {
  return {
    state: join(dataDirectory, HEARTBEAT_STATE_FILE),
    lock: join(dataDirectory, HEARTBEAT_LOCK_FILE),
  }
}

function readHostProcessId(environment) {
  const value = Number(environment.AISIDEQUEST_HOST_PID)
  return Number.isInteger(value) && value > 0 ? value : null
}

function isHeartbeatState(value) {
  return typeof value === 'object'
    && value !== null
    && value.schemaVersion === 1
    && typeof value.sessionKey === 'string'
    && typeof value.turnKey === 'string'
    && typeof value.startedAt === 'string'
    && typeof value.lastHookAt === 'string'
    && typeof value.nextHeartbeatAt === 'string'
    && (value.hostPid === null || Number.isInteger(value.hostPid))
}

async function readState(statePath) {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8'))
    return isHeartbeatState(value) ? value : null
  } catch {
    return null
  }
}

async function writeState(statePath, state) {
  const temporaryPath = `${statePath}.${process.pid}.tmp`
  const handle = await open(temporaryPath, 'w', 0o600)

  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  await rename(temporaryPath, statePath)
}

async function withStateLock(dataDirectory, work) {
  await mkdir(dataDirectory, { recursive: true })
  const paths = statePaths(dataDirectory)
  const release = await acquireFileLock(paths.lock)

  try {
    return await work(paths)
  } finally {
    await release()
  }
}

export async function updateHeartbeatState(
  event,
  dataDirectory,
  {
    environment = process.env,
    now = new Date(),
  } = {},
) {
  return withStateLock(dataDirectory, async (paths) => {
    const current = await readState(paths.state)
    const hostPid = readHostProcessId(environment)

    if (event.event === 'SessionStart') {
      if (current) {
        await rm(paths.state, { force: true })
      }
      return null
    }

    if (event.event === 'UserPromptSubmit' && event.turnKey) {
      const state = {
        schemaVersion: 1,
        sessionKey: event.sessionKey,
        turnKey: event.turnKey,
        hostPid,
        startedAt: now.toISOString(),
        lastHookAt: now.toISOString(),
        nextHeartbeatAt: new Date(
          now.getTime() + HEARTBEAT_INTERVAL_MS,
        ).toISOString(),
      }
      await writeState(paths.state, state)
      return state
    }

    if (!current || event.turnKey !== current.turnKey) {
      return current
    }

    if (event.event === 'Stop') {
      await rm(paths.state, { force: true })
      return null
    }

    const next = {
      ...current,
      hostPid: hostPid ?? current.hostPid,
      lastHookAt: now.toISOString(),
    }
    await writeState(paths.state, next)
    return next
  })
}

export async function readHeartbeatState(dataDirectory) {
  return withStateLock(dataDirectory, async (paths) => readState(paths.state))
}

export async function enqueueDueHeartbeat(
  dataDirectory,
  {
    now = new Date(),
    processAlive = isProcessAlive,
  } = {},
) {
  return withStateLock(dataDirectory, async (paths) => {
    const state = await readState(paths.state)

    if (!state) {
      return { active: false, enqueued: false, nextHeartbeatAt: null }
    }

    const startedAt = Date.parse(state.startedAt)
    const lastHookAt = Date.parse(state.lastHookAt)
    const nextHeartbeatAt = Date.parse(state.nextHeartbeatAt)
    const hostStopped = state.hostPid !== null && !processAlive(state.hostPid)
    const fallbackLeaseExpired = state.hostPid === null
      && now.getTime() - lastHookAt >= HEARTBEAT_FALLBACK_LEASE_MS
    const maxTurnExpired = now.getTime() - startedAt >= HEARTBEAT_MAX_TURN_MS

    if (
      !Number.isFinite(startedAt)
      || !Number.isFinite(lastHookAt)
      || !Number.isFinite(nextHeartbeatAt)
      || hostStopped
      || fallbackLeaseExpired
      || maxTurnExpired
    ) {
      await rm(paths.state, { force: true })
      return { active: false, enqueued: false, nextHeartbeatAt: null }
    }

    if (now.getTime() < nextHeartbeatAt) {
      return {
        active: true,
        enqueued: false,
        nextHeartbeatAt: state.nextHeartbeatAt,
      }
    }

    const event = {
      schemaVersion: 1,
      eventId: randomUUID(),
      provider: 'CODEX',
      event: 'Heartbeat',
      sessionKey: state.sessionKey,
      turnKey: state.turnKey,
      observedAt: now.toISOString(),
    }
    const queued = await enqueueEvent(event, dataDirectory, { now })
    const next = {
      ...state,
      nextHeartbeatAt: new Date(
        now.getTime() + HEARTBEAT_INTERVAL_MS,
      ).toISOString(),
    }
    await writeState(paths.state, next)

    return {
      active: true,
      enqueued: queued.queued,
      nextHeartbeatAt: next.nextHeartbeatAt,
    }
  })
}
