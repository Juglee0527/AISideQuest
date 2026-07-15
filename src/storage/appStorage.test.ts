import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  loadQuestHistoryState,
  loadSessionState,
  saveQuestHistoryState,
  saveSessionState,
  type PersistedQuestHistoryState,
  type PersistedSessionState,
} from './appStorage'

const activeSessionState: PersistedSessionState = {
  activeSession: {
    id: 'session-1',
    startedAt: '2026-07-15T00:00:00.000Z',
    endedAt: null,
    duration: null,
  },
  completedSessions: [],
}

const questHistoryState: PersistedQuestHistoryState = {
  questHistories: [
    {
      id: 'history-1',
      questId: 'quest-1',
      sessionId: 'session-1',
      completed: true,
      completedAt: '2026-07-15T00:01:00.000Z',
    },
  ],
}

describe('app storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips session and quest history state', () => {
    expect(saveSessionState(activeSessionState)).toBe(true)
    expect(saveQuestHistoryState(questHistoryState)).toBe(true)
    expect(loadSessionState()).toEqual(activeSessionState)
    expect(loadQuestHistoryState()).toEqual(questHistoryState)
  })

  it('rejects corrupted JSON and unsupported schema versions', () => {
    window.localStorage.setItem('aisidequest.sessions', '{broken')
    expect(loadSessionState()).toBeNull()

    window.localStorage.setItem(
      'aisidequest.sessions',
      JSON.stringify({ version: 2, data: activeSessionState }),
    )
    expect(loadSessionState()).toBeNull()
  })

  it('rejects duplicate sessions and duplicate quest completions', () => {
    const duplicateSessionState: PersistedSessionState = {
      activeSession: activeSessionState.activeSession,
      completedSessions: [
        {
          id: 'session-1',
          startedAt: '2026-07-15T00:00:00.000Z',
          endedAt: '2026-07-15T00:01:00.000Z',
          duration: 60_000,
        },
      ],
    }
    const duplicateQuestHistoryState: PersistedQuestHistoryState = {
      questHistories: [
        questHistoryState.questHistories[0],
        { ...questHistoryState.questHistories[0], id: 'history-2' },
      ],
    }

    expect(saveSessionState(duplicateSessionState)).toBe(false)
    expect(saveQuestHistoryState(duplicateQuestHistoryState)).toBe(false)
  })

  it('falls back safely when LocalStorage access fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadSessionState()).toBeNull()

    vi.restoreAllMocks()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(saveSessionState(activeSessionState)).toBe(false)
  })
})
