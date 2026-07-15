import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

export function sanitizeHookPayload(payload, receivedAt = new Date()) {
  if (!isRecord(payload) || !ALLOWED_EVENT_NAMES.has(payload.hook_event_name)) {
    return null
  }

  const sessionHash = hashIdentifier(payload.session_id)

  if (sessionHash === null || Number.isNaN(receivedAt.getTime())) {
    return null
  }

  const turnHash = hashIdentifier(payload.turn_id)

  return {
    schemaVersion: 1,
    event: payload.hook_event_name,
    sessionHash,
    ...(turnHash === null ? {} : { turnHash }),
    receivedAt: receivedAt.toISOString(),
  }
}

export function resolveDataDirectory(environment = process.env) {
  const configuredDirectory = environment.AISIDEQUEST_POC_DATA_DIR?.trim()
  const pluginDataDirectory = environment.PLUGIN_DATA?.trim()

  if (configuredDirectory) {
    return configuredDirectory
  }

  if (pluginDataDirectory) {
    return pluginDataDirectory
  }

  return join(tmpdir(), 'aisidequest-hook-poc')
}

export async function appendEvent(record, dataDirectory) {
  await mkdir(dataDirectory, { recursive: true })

  const logPath = join(dataDirectory, EVENT_LOG_FILE)
  await appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8')

  return logPath
}
