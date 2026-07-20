import type { Request } from 'express'

export const SESSION_STATUSES = [
  'RUNNING',
  'WAITING_FOR_USER',
  'COMPLETED',
  'FAILED',
  'ABANDONED',
] as const

export type SessionStatus = (typeof SESSION_STATUSES)[number]
export type SessionOrigin = 'HOOK' | 'MANUAL'
export type TimingQuality = 'EXACT' | 'DEGRADED'

export const SAFE_OPERATION_LABELS = [
  'git status',
  'git diff',
  'git log',
  'git show',
  'npm test',
  'npm build',
  'npm typecheck',
  'npm lint',
  'npm install',
  'Gradle test',
  'Gradle build',
  'Maven test',
  'Maven build',
  'Python test',
  'Cargo test',
  'Go test',
  'Docker',
  '코드 변경',
  '기타 명령',
] as const

export type SafeOperationLabel = (typeof SAFE_OPERATION_LABELS)[number]

export type TerminalReason =
  | 'HOOK_STOP'
  | 'MANUAL_COMPLETED'
  | 'RECOVERED_LATE_STOP'
  | 'MANUAL_FAILED'
  | 'MANUAL_CANCELLED'
  | 'HEARTBEAT_TIMEOUT'
  | 'MANUAL_TIMEOUT'
  | 'SUPERSEDED_BY_NEW_TURN'

export interface SessionRow {
  id: string
  user_id: string
  provider: 'CODEX'
  status: SessionStatus
  origin: SessionOrigin
  external_session_key: string | null
  external_turn_key: string | null
  started_at: Date
  ended_at: Date | null
  last_activity_at: Date
  terminal_reason: TerminalReason | null
  timing_quality: TimingQuality
  workspace_label: string | null
  operation_label: SafeOperationLabel | null
  version: number
}

export interface SessionSnapshot {
  id: string
  provider: 'CODEX'
  status: SessionStatus
  origin: SessionOrigin
  autoLinked: boolean
  startedAt: string
  endedAt: string | null
  lastActivityAt: string
  durationMs: number
  terminalReason: TerminalReason | null
  timingQuality: TimingQuality
  workspaceLabel: string | null
  operationLabel: SafeOperationLabel | null
  version: number
}

export interface DeviceAuthContext {
  deviceId: string
  userId: string
}

export interface DeviceAuthenticatedRequest extends Request {
  deviceAuth: DeviceAuthContext
}

export type IntegrationEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'Stop'
  | 'Heartbeat'

export type IntegrationProcessingResult =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'DEFERRED'
  | 'IGNORED_TERMINAL'
  | 'IGNORED_ORPHAN'

export interface IntegrationEventResponse {
  eventId: string
  result: IntegrationProcessingResult
  session: SessionSnapshot | null
}
