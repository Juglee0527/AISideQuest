import { describe, expect, it } from 'vitest'

import type { Quest } from '../types/quest'
import type { QuestHistory } from '../types/questHistory'
import type { Session } from '../types/session'
import { calculateActivityStatistics, getPeriodRange } from './statistics'

const toIso = (
  year: number,
  month: number,
  date: number,
  hour = 0,
  minute = 0,
) => new Date(year, month - 1, date, hour, minute).toISOString()

const quests: readonly Quest[] = [
  {
    id: 'quest-a', code: 'quest-a', version: 1, title: 'A', description: 'A',
    rewardPoints: 500, estimatedMinutes: 3, passScore: 100,
    retryAllowed: true, completionStatus: 'NOT_STARTED', latestAttempt: null,
  },
  {
    id: 'quest-b', code: 'quest-b', version: 1, title: 'B', description: 'B',
    rewardPoints: 100, estimatedMinutes: 2, passScore: 100,
    retryAllowed: true, completionStatus: 'NOT_STARTED', latestAttempt: null,
  },
]

function createSession({
  id,
  startedAt,
  endedAt,
}: {
  id: string
  startedAt: string
  endedAt: string | null
}): Session {
  const isActive = endedAt === null

  return {
    id,
    provider: 'CODEX',
    status: isActive ? 'RUNNING' : 'COMPLETED',
    origin: 'MANUAL',
    autoLinked: false,
    startedAt,
    endedAt,
    lastActivityAt: endedAt ?? startedAt,
    durationMs: endedAt === null
      ? 0
      : Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    terminalReason: isActive ? null : 'MANUAL_COMPLETED',
    timingQuality: 'EXACT',
    version: 1,
  }
}

describe('activity statistics', () => {
  it('counts only the portion of a session overlapping today', () => {
    const currentTime = new Date(2026, 6, 15, 12).getTime()
    const completedSessions: Session[] = [
      createSession({
        id: 'today',
        startedAt: toIso(2026, 7, 15, 10),
        endedAt: toIso(2026, 7, 15, 10, 30),
      }),
      createSession({
        id: 'cross-midnight',
        startedAt: toIso(2026, 7, 14, 23, 50),
        endedAt: toIso(2026, 7, 15, 0, 10),
      }),
      createSession({
        id: 'previous-day',
        startedAt: toIso(2026, 7, 14, 10),
        endedAt: toIso(2026, 7, 14, 11),
      }),
    ]
    const activeSession = createSession({
      id: 'active',
      startedAt: toIso(2026, 7, 15, 11, 50),
      endedAt: null,
    })

    const result = calculateActivityStatistics({
      period: 'today',
      currentTime,
      activeSession,
      completedSessions,
      questHistories: [],
      quests,
    })

    expect(result.waitDuration).toBe(50 * 60_000)
  })

  it('counts completed quests and known rewards in the selected period', () => {
    const currentTime = new Date(2026, 6, 15, 12).getTime()
    const questHistories: QuestHistory[] = [
      { id: 'h1', questId: 'quest-a', sessionId: 's1', completed: true, completedAt: toIso(2026, 7, 15, 10) },
      { id: 'h2', questId: 'quest-b', sessionId: 's1', completed: true, completedAt: toIso(2026, 7, 15, 11) },
      { id: 'h3', questId: 'unknown', sessionId: 's1', completed: true, completedAt: toIso(2026, 7, 15, 11, 30) },
      { id: 'h4', questId: 'quest-a', sessionId: 'future', completed: true, completedAt: toIso(2026, 7, 15, 13) },
      { id: 'h5', questId: 'quest-a', sessionId: 'old', completed: true, completedAt: toIso(2026, 7, 14, 10) },
    ]

    const result = calculateActivityStatistics({
      period: 'today',
      currentTime,
      activeSession: null,
      completedSessions: [],
      questHistories,
      quests,
    })

    expect(result.completedQuestCount).toBe(3)
    expect(result.rewardPoints).toBe(600)
    expect(result.estimatedSavedMinutes).toBeNull()
  })

  it('starts the weekly range on Monday and monthly range on day one', () => {
    const currentTime = new Date(2026, 6, 15, 12).getTime()
    const weekRange = getPeriodRange('week', currentTime)
    const monthRange = getPeriodRange('month', currentTime)

    expect(weekRange).not.toBeNull()
    expect(new Date(weekRange!.start).getDay()).toBe(1)
    expect(new Date(weekRange!.start).getHours()).toBe(0)
    expect(monthRange).not.toBeNull()
    expect(new Date(monthRange!.start).getDate()).toBe(1)
    expect(new Date(monthRange!.start).getHours()).toBe(0)
  })

  it('returns empty statistics for an invalid current time', () => {
    expect(
      calculateActivityStatistics({
        period: 'month',
        currentTime: Number.NaN,
        activeSession: null,
        completedSessions: [],
        questHistories: [],
        quests,
      }),
    ).toEqual({
      waitDuration: 0,
      completedQuestCount: 0,
      rewardPoints: 0,
      estimatedSavedMinutes: null,
    })
  })
})
