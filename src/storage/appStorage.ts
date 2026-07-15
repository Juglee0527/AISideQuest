import type { QuestHistory } from '../types/questHistory'
import type { Session } from '../types/session'

const STORAGE_VERSION = 1
const SESSION_STORAGE_KEY = 'aisidequest.sessions'
const QUEST_HISTORY_STORAGE_KEY = 'aisidequest.questHistories'

export interface PersistedSessionState {
  activeSession: Session | null
  completedSessions: Session[]
}

export interface PersistedQuestHistoryState {
  questHistories: QuestHistory[]
}

interface StorageEnvelope<T> {
  version: number
  data: T
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

function isActiveSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isIsoDateString(value.startedAt) &&
    value.endedAt === null &&
    value.duration === null
  )
}

function isCompletedSession(value: unknown): value is Session {
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

function hasUniqueSessionIds(state: PersistedSessionState) {
  const sessionIds = [
    ...(state.activeSession === null ? [] : [state.activeSession.id]),
    ...state.completedSessions.map((session) => session.id),
  ]

  return new Set(sessionIds).size === sessionIds.length
}

function isPersistedSessionState(value: unknown): value is PersistedSessionState {
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

export function loadSessionState() {
  return loadStorageValue(SESSION_STORAGE_KEY, isPersistedSessionState)
}

export function saveSessionState(state: PersistedSessionState) {
  if (!isPersistedSessionState(state)) {
    return false
  }

  return saveStorageValue(SESSION_STORAGE_KEY, state)
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
