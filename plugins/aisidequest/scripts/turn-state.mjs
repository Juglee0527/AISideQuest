import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveDataDirectory } from './event-recorder.mjs'
import { isProcessAlive } from './process-lock.mjs'

const TURN_STATE_FILE = 'active-turn.json'
export const HEARTBEAT_FALLBACK_LEASE_MS = 120_000
export const HEARTBEAT_MAX_TURN_MS = 12 * 60 * 60 * 1_000

function statePath(environment) {
  return join(resolveDataDirectory(environment), TURN_STATE_FILE)
}

export async function readActiveTurn(environment = process.env) {
  try {
    const state = JSON.parse(await readFile(statePath(environment), 'utf8'))
    if (typeof state?.sessionKey !== 'string' || typeof state?.turnKey !== 'string') {
      return null
    }

    return {
      ...state,
      hostPid: Number.isSafeInteger(state.hostPid) && state.hostPid > 0
        ? state.hostPid
        : null,
      lastHookAt: typeof state.lastHookAt === 'string'
        ? state.lastHookAt
        : state.activatedAt,
    }
  } catch {
    return null
  }
}

function readHostProcessId(environment) {
  const hostPid = Number(environment.AISIDEQUEST_HOST_PID)
  return Number.isSafeInteger(hostPid) && hostPid > 0 ? hostPid : null
}

export async function activateTurn(event, environment = process.env, now = new Date()) {
  if (event.event !== 'UserPromptSubmit' || typeof event.turnKey !== 'string') return
  const directory = resolveDataDirectory(environment)
  const path = statePath(environment)
  const temporaryPath = `${path}.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify({
    schemaVersion: 1,
    sessionKey: event.sessionKey,
    turnKey: event.turnKey,
    hostPid: readHostProcessId(environment),
    activatedAt: now.toISOString(),
    lastHookAt: now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
  })}\n`, 'utf8')
  await rename(temporaryPath, path)
}

export async function refreshTurn(event, environment = process.env, now = new Date()) {
  if (
    event.event === 'SessionStart' ||
    event.event === 'UserPromptSubmit' ||
    event.event === 'Stop' ||
    typeof event.turnKey !== 'string'
  ) return

  const current = await readActiveTurn(environment)
  if (!current || current.turnKey !== event.turnKey) return
  const path = statePath(environment)
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({
    ...current,
    hostPid: readHostProcessId(environment) ?? current.hostPid,
    lastHookAt: now.toISOString(),
  })}\n`, 'utf8')
  await rename(temporaryPath, path)
}

export function isTurnAlive(
  turn,
  now = new Date(),
  processAlive = isProcessAlive,
) {
  const activatedAt = Date.parse(turn.activatedAt)
  const lastHookAt = Date.parse(turn.lastHookAt ?? turn.activatedAt)

  if (!Number.isFinite(activatedAt) || !Number.isFinite(lastHookAt)) return false
  if (now.getTime() - activatedAt >= HEARTBEAT_MAX_TURN_MS) return false

  return turn.hostPid === null
    ? now.getTime() - lastHookAt < HEARTBEAT_FALLBACK_LEASE_MS
    : processAlive(turn.hostPid)
}

export async function removeTurnIfCurrent(turn, environment = process.env) {
  const current = await readActiveTurn(environment)
  if (current?.turnKey !== turn.turnKey) return false
  await rm(statePath(environment), { force: true })
  return true
}

export async function markHeartbeat(turn, environment = process.env, now = new Date()) {
  const current = await readActiveTurn(environment)
  if (!current || current.turnKey !== turn.turnKey) return false
  const path = statePath(environment)
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({ ...current, lastHeartbeatAt: now.toISOString() })}\n`, 'utf8')
  await rename(temporaryPath, path)
  return true
}

export async function deactivateTurn(event, environment = process.env) {
  if (event.event !== 'Stop' || typeof event.turnKey !== 'string') return
  const current = await readActiveTurn(environment)
  if (current?.turnKey === event.turnKey) {
    await rm(statePath(environment), { force: true })
  }
}
