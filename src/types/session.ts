export type SessionStatus =
  | 'RUNNING'
  | 'WAITING_FOR_USER'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABANDONED'

export type SessionTerminalReason =
  | 'HOOK_STOP'
  | 'MANUAL_COMPLETED'
  | 'RECOVERED_LATE_STOP'
  | 'MANUAL_FAILED'
  | 'MANUAL_CANCELLED'
  | 'HEARTBEAT_TIMEOUT'
  | 'MANUAL_TIMEOUT'
  | 'SUPERSEDED_BY_NEW_TURN'

export interface Session {
  id: string
  provider: 'CODEX'
  status: SessionStatus
  origin: 'HOOK' | 'MANUAL'
  autoLinked: boolean
  startedAt: string
  endedAt: string | null
  lastActivityAt: string
  durationMs: number
  terminalReason: SessionTerminalReason | null
  timingQuality: 'EXACT' | 'DEGRADED'
  version: number
}

export interface SessionHistoryPage {
  items: Session[]
  nextCursor: string | null
}

export interface LegacySession {
  id: string
  startedAt: string
  endedAt: string | null
  duration: number | null
}
