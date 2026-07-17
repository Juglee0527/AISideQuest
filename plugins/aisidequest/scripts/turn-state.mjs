import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveDataDirectory } from './event-recorder.mjs'

const TURN_STATE_FILE = 'active-turn.json'

function statePath(environment) {
  return join(resolveDataDirectory(environment), TURN_STATE_FILE)
}

export async function readActiveTurn(environment = process.env) {
  try {
    const state = JSON.parse(await readFile(statePath(environment), 'utf8'))
    return typeof state?.sessionKey === 'string' && typeof state?.turnKey === 'string'
      ? state
      : null
  } catch {
    return null
  }
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
    activatedAt: now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
  })}\n`, 'utf8')
  await rename(temporaryPath, path)
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
