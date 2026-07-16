import type { QuestHistory } from '../types/questHistory'
import type { LegacySession } from '../types/session'

const STORAGE_VERSION = 1
const LEGACY_SESSION_STORAGE_KEY = 'aisidequest.sessions'
const LEGACY_QUEST_HISTORY_STORAGE_KEY = 'aisidequest.questHistories'
const QUEST_HISTORY_STORAGE_KEY = 'aisidequest.questHistories.v2'
const LEGACY_MIGRATION_STORAGE_KEY = 'aisidequest.legacyMigration'
const LEGACY_REFERENCE_STORAGE_KEY = 'aisidequest.legacyReference'

export interface PersistedLegacySessionState {
  activeSession: LegacySession | null
  completedSessions: LegacySession[]
}

export interface PersistedQuestHistoryState {
  questHistories: QuestHistory[]
}

interface StorageEnvelope<T> {
  version: number
  data: T
}

export interface LegacyDataInspection {
  status: 'none' | 'ready' | 'corrupted' | 'unavailable'
  completedSessionCount: number
  completedQuestCount: number
  totalDurationMs: number
  hasActiveSession: boolean
}

export interface LegacyReferenceSummary {
  completedSessionCount: number
  completedQuestCount: number
  totalDurationMs: number
  hadActiveSession: boolean
  migratedAt: string
}

type LegacyMigrationMode = 'discarded' | 'referenced'

interface LegacyMigrationMarker {
  mode: LegacyMigrationMode
  completedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isActiveSession(value: unknown): value is LegacySession {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isIsoDateString(value.startedAt) &&
    value.endedAt === null &&
    value.duration === null
  )
}

function isCompletedSession(value: unknown): value is LegacySession {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isIsoDateString(value.startedAt) ||
    !isIsoDateString(value.endedAt) ||
    typeof value.duration !== 'number' ||
    !Number.isSafeInteger(value.duration) ||
    value.duration < 0
  ) {
    return false
  }

  return Date.parse(value.endedAt) >= Date.parse(value.startedAt)
}

function hasUniqueSessionIds(state: PersistedLegacySessionState) {
  const sessionIds = [
    ...(state.activeSession === null ? [] : [state.activeSession.id]),
    ...state.completedSessions.map((session) => session.id),
  ]

  return new Set(sessionIds).size === sessionIds.length
}

function isPersistedSessionState(
  value: unknown,
): value is PersistedLegacySessionState {
  if (
    !isRecord(value) ||
    !(value.activeSession === null || isActiveSession(value.activeSession)) ||
    !Array.isArray(value.completedSessions) ||
    !value.completedSessions.every(isCompletedSession)
  ) {
    return false
  }

  return hasUniqueSessionIds({
    activeSession: value.activeSession,
    completedSessions: value.completedSessions,
  })
}

function isQuestHistory(value: unknown): value is QuestHistory {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.questId) &&
    isNonEmptyString(value.sessionId) &&
    value.completed === true &&
    isIsoDateString(value.completedAt)
  )
}

function hasUniqueQuestHistories(questHistories: QuestHistory[]) {
  const historyIds = questHistories.map((history) => history.id)
  const completionKeys = questHistories.map(
    (history) => `${history.sessionId}:${history.questId}`,
  )

  return (
    new Set(historyIds).size === historyIds.length &&
    new Set(completionKeys).size === completionKeys.length
  )
}

function isPersistedQuestHistoryState(
  value: unknown,
): value is PersistedQuestHistoryState {
  if (
    !isRecord(value) ||
    !Array.isArray(value.questHistories) ||
    !value.questHistories.every(isQuestHistory)
  ) {
    return false
  }

  return hasUniqueQuestHistories(value.questHistories)
}

function isLegacyMigrationMarker(value: unknown): value is LegacyMigrationMarker {
  return (
    isRecord(value) &&
    (value.mode === 'discarded' || value.mode === 'referenced') &&
    isIsoDateString(value.completedAt)
  )
}

function isLegacyReferenceSummary(
  value: unknown,
): value is LegacyReferenceSummary {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.completedSessionCount) &&
    (value.completedSessionCount as number) >= 0 &&
    Number.isSafeInteger(value.completedQuestCount) &&
    (value.completedQuestCount as number) >= 0 &&
    Number.isSafeInteger(value.totalDurationMs) &&
    (value.totalDurationMs as number) >= 0 &&
    typeof value.hadActiveSession === 'boolean' &&
    isIsoDateString(value.migratedAt)
  )
}

function getLocalStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function loadStorageValue<T>(
  key: string,
  validate: (value: unknown) => value is T,
): T | null {
  const storage = getLocalStorage()

  if (storage === null) {
    return null
  }

  try {
    const storedValue = storage.getItem(key)

    if (storedValue === null) {
      return null
    }

    const parsedValue: unknown = JSON.parse(storedValue)

    if (
      !isRecord(parsedValue) ||
      parsedValue.version !== STORAGE_VERSION ||
      !validate(parsedValue.data)
    ) {
      return null
    }

    return parsedValue.data
  } catch {
    return null
  }
}

function parseStorageValue<T>(
  storedValue: string | null,
  validate: (value: unknown) => value is T,
): T | null {
  if (storedValue === null) {
    return null
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue)

    if (
      !isRecord(parsedValue) ||
      parsedValue.version !== STORAGE_VERSION ||
      !validate(parsedValue.data)
    ) {
      return null
    }

    return parsedValue.data
  } catch {
    return null
  }
}

function saveStorageValue<T>(key: string, data: T) {
  const storage = getLocalStorage()

  if (storage === null) {
    return false
  }

  const envelope: StorageEnvelope<T> = {
    version: STORAGE_VERSION,
    data,
  }

  try {
    storage.setItem(key, JSON.stringify(envelope))
    return true
  } catch {
    return false
  }
}

export function loadLegacySessionState() {
  return loadStorageValue(LEGACY_SESSION_STORAGE_KEY, isPersistedSessionState)
}

export function saveLegacySessionState(state: PersistedLegacySessionState) {
  if (!isPersistedSessionState(state)) {
    return false
  }

  return saveStorageValue(LEGACY_SESSION_STORAGE_KEY, state)
}

export function loadLegacyQuestHistoryState() {
  return loadStorageValue(
    LEGACY_QUEST_HISTORY_STORAGE_KEY,
    isPersistedQuestHistoryState,
  )
}

export function saveLegacyQuestHistoryState(state: PersistedQuestHistoryState) {
  if (!isPersistedQuestHistoryState(state)) {
    return false
  }

  return saveStorageValue(LEGACY_QUEST_HISTORY_STORAGE_KEY, state)
}

export function loadQuestHistoryState() {
  return loadStorageValue(QUEST_HISTORY_STORAGE_KEY, isPersistedQuestHistoryState)
}

export function saveQuestHistoryState(state: PersistedQuestHistoryState) {
  if (!isPersistedQuestHistoryState(state)) {
    return false
  }

  return saveStorageValue(QUEST_HISTORY_STORAGE_KEY, state)
}

function emptyLegacyDataInspection(
  status: LegacyDataInspection['status'],
): LegacyDataInspection {
  return {
    status,
    completedSessionCount: 0,
    completedQuestCount: 0,
    totalDurationMs: 0,
    hasActiveSession: false,
  }
}

function removeLegacySourceValues(storage: Storage) {
  try {
    storage.removeItem(LEGACY_SESSION_STORAGE_KEY)
    storage.removeItem(LEGACY_QUEST_HISTORY_STORAGE_KEY)
  } catch {
    // 완료 marker가 있으면 다음 실행에서 다시 정리한다.
  }
}

export function inspectLegacyData(): LegacyDataInspection {
  const storage = getLocalStorage()

  if (storage === null) {
    return emptyLegacyDataInspection('unavailable')
  }

  try {
    const markerValue = storage.getItem(LEGACY_MIGRATION_STORAGE_KEY)
    const marker = parseStorageValue(markerValue, isLegacyMigrationMarker)

    if (marker !== null) {
      removeLegacySourceValues(storage)
      return emptyLegacyDataInspection('none')
    }

    const sessionValue = storage.getItem(LEGACY_SESSION_STORAGE_KEY)
    const questHistoryValue = storage.getItem(LEGACY_QUEST_HISTORY_STORAGE_KEY)

    if (sessionValue === null && questHistoryValue === null) {
      return emptyLegacyDataInspection('none')
    }

    const sessionState = parseStorageValue(
      sessionValue,
      isPersistedSessionState,
    )
    const questHistoryState = parseStorageValue(
      questHistoryValue,
      isPersistedQuestHistoryState,
    )
    const hasCorruptedValue =
      (sessionValue !== null && sessionState === null) ||
      (questHistoryValue !== null && questHistoryState === null)

    if (hasCorruptedValue) {
      return emptyLegacyDataInspection('corrupted')
    }

    const completedSessions = sessionState?.completedSessions ?? []
    const totalDurationMs = completedSessions.reduce(
      (total, session) => total + (session.duration ?? 0),
      0,
    )

    if (!Number.isSafeInteger(totalDurationMs)) {
      return emptyLegacyDataInspection('corrupted')
    }

    return {
      status: 'ready',
      completedSessionCount: completedSessions.length,
      completedQuestCount: questHistoryState?.questHistories.length ?? 0,
      totalDurationMs,
      hasActiveSession: sessionState?.activeSession !== null && sessionState?.activeSession !== undefined,
    }
  } catch {
    return emptyLegacyDataInspection('unavailable')
  }
}

export function completeLegacyDataMigration(
  mode: LegacyMigrationMode,
): boolean {
  const storage = getLocalStorage()

  if (storage === null) {
    return false
  }

  const inspection = inspectLegacyData()

  if (inspection.status === 'unavailable') {
    return false
  }

  if (mode === 'referenced' && inspection.status !== 'ready') {
    return false
  }

  const completedAt = new Date().toISOString()

  try {
    if (mode === 'referenced') {
      const referenceSummary: LegacyReferenceSummary = {
        completedSessionCount: inspection.completedSessionCount,
        completedQuestCount: inspection.completedQuestCount,
        totalDurationMs: inspection.totalDurationMs,
        hadActiveSession: inspection.hasActiveSession,
        migratedAt: completedAt,
      }

      if (!saveStorageValue(LEGACY_REFERENCE_STORAGE_KEY, referenceSummary)) {
        return false
      }
    } else {
      storage.removeItem(LEGACY_REFERENCE_STORAGE_KEY)
    }

    const marker: LegacyMigrationMarker = {
      mode,
      completedAt,
    }

    if (!saveStorageValue(LEGACY_MIGRATION_STORAGE_KEY, marker)) {
      return false
    }

    removeLegacySourceValues(storage)
    return true
  } catch {
    return false
  }
}

export function loadLegacyReferenceSummary() {
  const marker = loadStorageValue(
    LEGACY_MIGRATION_STORAGE_KEY,
    isLegacyMigrationMarker,
  )

  if (marker?.mode !== 'referenced') {
    return null
  }

  return loadStorageValue(
    LEGACY_REFERENCE_STORAGE_KEY,
    isLegacyReferenceSummary,
  )
}
