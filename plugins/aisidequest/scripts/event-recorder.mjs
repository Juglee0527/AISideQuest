import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const EVENT_LOG_FILE = 'events.jsonl'
const ALLOWED_EVENT_NAMES = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hashIdentifier(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  return createHash('sha256').update(value.trim()).digest('hex')
}

export function sanitizeHookPayload(
  payload,
  observedAt = new Date(),
  eventId = randomUUID(),
) {
  if (!isRecord(payload) || !ALLOWED_EVENT_NAMES.has(payload.hook_event_name)) {
    return null
  }

  const sessionKey = hashIdentifier(payload.session_id)

  if (
    sessionKey === null ||
    Number.isNaN(observedAt.getTime()) ||
    typeof eventId !== 'string'
  ) {
    return null
  }

  const turnKey = hashIdentifier(payload.turn_id)

  return {
    schemaVersion: 1,
    eventId,
    provider: 'CODEX',
    event: payload.hook_event_name,
    sessionKey,
    ...(turnKey === null ? {} : { turnKey }),
    observedAt: observedAt.toISOString(),
  }
}

export function resolveDataDirectory(environment = process.env) {
  const configuredDirectory = environment.AISIDEQUEST_DATA_DIR?.trim()
  const pluginDataDirectory = environment.PLUGIN_DATA?.trim()

  if (configuredDirectory) {
    return configuredDirectory
  }

  if (pluginDataDirectory) {
    return pluginDataDirectory
  }

  const applicationDataDirectory = environment.LOCALAPPDATA?.trim()
    || environment.XDG_DATA_HOME?.trim()
    || join(homedir(), '.local', 'share')

  return join(applicationDataDirectory, 'AISideQuest', 'plugin')
}

export async function appendEvent(record, dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })

  const logPath = join(dataDirectory, EVENT_LOG_FILE)
  await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8')

  return logPath
}
