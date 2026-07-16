import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  completeLegacyDataMigration,
  inspectLegacyData,
  loadLegacyQuestHistoryState,
  loadLegacyReferenceSummary,
  loadLegacySessionState,
  loadQuestHistoryState,
  saveLegacyQuestHistoryState,
  saveLegacySessionState,
  saveQuestHistoryState,
  type PersistedLegacySessionState,
  type PersistedQuestHistoryState,
} from './appStorage'

const activeSessionState: PersistedLegacySessionState = {
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

  it('separates legacy values from the new quest history key', () => {
    expect(saveLegacySessionState(activeSessionState)).toBe(true)
    expect(saveLegacyQuestHistoryState(questHistoryState)).toBe(true)

    expect(loadLegacySessionState()).toEqual(activeSessionState)
    expect(loadLegacyQuestHistoryState()).toEqual(questHistoryState)
    expect(loadQuestHistoryState()).toBeNull()

    expect(saveQuestHistoryState(questHistoryState)).toBe(true)
    expect(loadQuestHistoryState()).toEqual(questHistoryState)
  })

  it('rejects corrupted JSON and unsupported schema versions', () => {
    window.localStorage.setItem('aisidequest.sessions', '{broken')
    expect(loadLegacySessionState()).toBeNull()

    window.localStorage.setItem(
      'aisidequest.sessions',
      JSON.stringify({ version: 2, data: activeSessionState }),
    )
    expect(loadLegacySessionState()).toBeNull()
  })

  it('rejects duplicate sessions and duplicate quest completions', () => {
    const duplicateSessionState: PersistedLegacySessionState = {
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

    expect(saveLegacySessionState(duplicateSessionState)).toBe(false)
    expect(saveQuestHistoryState(duplicateQuestHistoryState)).toBe(false)
  })

  it('keeps only a reward-free summary and cleans legacy source values', () => {
    const completedState: PersistedLegacySessionState = {
      activeSession: activeSessionState.activeSession,
      completedSessions: [
        {
          id: 'completed-1',
          startedAt: '2026-07-14T23:59:00.000Z',
          endedAt: '2026-07-15T00:01:00.000Z',
          duration: 120_000,
        },
      ],
    }

    expect(saveLegacySessionState(completedState)).toBe(true)
    expect(saveLegacyQuestHistoryState(questHistoryState)).toBe(true)
    expect(inspectLegacyData()).toEqual({
      status: 'ready',
      completedSessionCount: 1,
      completedQuestCount: 1,
      totalDurationMs: 120_000,
      hasActiveSession: true,
    })

    expect(completeLegacyDataMigration('referenced')).toBe(true)
    expect(inspectLegacyData().status).toBe('none')
    expect(window.localStorage.getItem('aisidequest.sessions')).toBeNull()
    expect(window.localStorage.getItem('aisidequest.questHistories')).toBeNull()
    expect(loadLegacyReferenceSummary()).toMatchObject({
      completedSessionCount: 1,
      completedQuestCount: 1,
      totalDurationMs: 120_000,
      hadActiveSession: true,
    })
  })

  it('allows corrupted legacy values to be discarded but not referenced', () => {
    window.localStorage.setItem('aisidequest.sessions', '{broken')

    expect(inspectLegacyData().status).toBe('corrupted')
    expect(completeLegacyDataMigration('referenced')).toBe(false)
    expect(completeLegacyDataMigration('discarded')).toBe(true)
    expect(inspectLegacyData().status).toBe('none')
    expect(loadLegacyReferenceSummary()).toBeNull()
  })

  it('retries source cleanup on the next run when removal initially fails', () => {
    expect(saveLegacySessionState(activeSessionState)).toBe(true)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('temporarily blocked')
    })

    expect(completeLegacyDataMigration('referenced')).toBe(true)
    expect(window.localStorage.getItem('aisidequest.sessions')).not.toBeNull()

    vi.restoreAllMocks()
    expect(inspectLegacyData().status).toBe('none')
    expect(window.localStorage.getItem('aisidequest.sessions')).toBeNull()
  })

  it('falls back safely when LocalStorage access or writes fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadLegacySessionState()).toBeNull()
    expect(inspectLegacyData().status).toBe('unavailable')

    vi.restoreAllMocks()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(saveLegacySessionState(activeSessionState)).toBe(false)
    expect(completeLegacyDataMigration('discarded')).toBe(false)
  })
})
