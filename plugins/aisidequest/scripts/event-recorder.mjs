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

const OPERATION_EVENTS = new Set([
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
])

const MAX_WORKSPACE_LABEL_LENGTH = 64

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hashIdentifier(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  return createHash('sha256').update(value.trim()).digest('hex')
}

export function sanitizeWorkspaceLabel(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  const segments = value.trim().split(/[\\/]+/).filter(Boolean)
  const folderName = segments.at(-1)

  if (!folderName) {
    return null
  }

  const normalized = folderName
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[^\p{L}\p{N}._ -]/gu, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
  let label = ''

  for (const character of normalized) {
    if ((label + character).length > MAX_WORKSPACE_LABEL_LENGTH) break
    label += character
  }

  label = label.trim()

  return label === '' ? null : label
}

function shellOperationLabel(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return '기타 명령'
  }

  const normalized = command.trim().replace(/\s+/g, ' ')

  if (/^(?:git|git\.exe)\s+status\b/i.test(normalized)) return 'git status'
  if (/^(?:git|git\.exe)\s+diff\b/i.test(normalized)) return 'git diff'
  if (/^(?:git|git\.exe)\s+log\b/i.test(normalized)) return 'git log'
  if (/^(?:git|git\.exe)\s+show\b/i.test(normalized)) return 'git show'

  if (/^(?:npm|npm\.cmd)\s+(?:run\s+)?test\b/i.test(normalized)) return 'npm test'
  if (/^(?:npm|npm\.cmd)\s+run\s+build\b/i.test(normalized)) return 'npm build'
  if (/^(?:npm|npm\.cmd)\s+run\s+typecheck\b/i.test(normalized)) return 'npm typecheck'
  if (/^(?:npm|npm\.cmd)\s+run\s+lint\b/i.test(normalized)) return 'npm lint'
  if (/^(?:npm|npm\.cmd)\s+(?:install|i)\b/i.test(normalized)) return 'npm install'

  if (/^(?:\.\\|\.\/)?gradlew(?:\.bat)?\b.*(?:[: ]test)\b/i.test(normalized)) return 'Gradle test'
  if (/^(?:\.\\|\.\/)?gradlew(?:\.bat)?\b.*(?:[: ]build)\b/i.test(normalized)) return 'Gradle build'
  if (/^(?:\.\\|\.\/)?mvnw(?:\.cmd)?\b.*\btest\b/i.test(normalized)) return 'Maven test'
  if (/^(?:\.\\|\.\/)?mvnw(?:\.cmd)?\b.*\b(?:package|verify)\b/i.test(normalized)) return 'Maven build'
  if (/^(?:pytest|python(?:\.exe)?\s+-m\s+pytest)\b/i.test(normalized)) return 'Python test'
  if (/^cargo(?:\.exe)?\s+test\b/i.test(normalized)) return 'Cargo test'
  if (/^go(?:\.exe)?\s+test\b/i.test(normalized)) return 'Go test'
  if (/^docker(?:\.exe)?\b/i.test(normalized)) return 'Docker'

  return '기타 명령'
}

export function classifyOperation(payload) {
  if (!isRecord(payload) || !OPERATION_EVENTS.has(payload.hook_event_name)) {
    return null
  }

  if (['apply_patch', 'Edit', 'Write'].includes(payload.tool_name)) {
    return '코드 변경'
  }

  if (payload.tool_name === 'Bash') {
    return shellOperationLabel(
      isRecord(payload.tool_input) ? payload.tool_input.command : null,
    )
  }

  return null
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
  const workspaceLabel = turnKey === null
    ? null
    : sanitizeWorkspaceLabel(payload.cwd)
  const operationLabel = classifyOperation(payload)

  return {
    schemaVersion: 1,
    eventId,
    provider: 'CODEX',
    event: payload.hook_event_name,
    sessionKey,
    ...(turnKey === null ? {} : { turnKey }),
    ...(workspaceLabel === null ? {} : { workspaceLabel }),
    ...(operationLabel === null ? {} : { operationLabel }),
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
