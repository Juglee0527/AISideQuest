import type { Quest } from '../types/quest'
import type { QuestHistory } from '../types/questHistory'
import type { Session } from '../types/session'

export type StatisticsPeriod = 'today' | 'week' | 'month'

export interface ActivityStatistics {
  waitDuration: number
  completedQuestCount: number
  rewardPoints: number
  estimatedSavedMinutes: null
}

interface StatisticsInput {
  period: StatisticsPeriod
  currentTime: number
  activeSession: Session | null
  completedSessions: readonly Session[]
  questHistories: readonly QuestHistory[]
  quests: readonly Quest[]
}

interface PeriodRange {
  start: number
  endExclusive: number
}

const EMPTY_STATISTICS: ActivityStatistics = {
  waitDuration: 0,
  completedQuestCount: 0,
  rewardPoints: 0,
  estimatedSavedMinutes: null,
}

export function getPeriodRange(
  period: StatisticsPeriod,
  currentTime: number,
): PeriodRange | null {
  if (!Number.isFinite(currentTime)) {
    return null
  }

  const currentDate = new Date(currentTime)
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const date = currentDate.getDate()
  let startDate: Date
  let endDate: Date

  if (period === 'today') {
    startDate = new Date(year, month, date)
    endDate = new Date(year, month, date + 1)
  } else if (period === 'week') {
    startDate = new Date(year, month, date)
    const daysSinceMonday = (startDate.getDay() + 6) % 7
    startDate.setDate(startDate.getDate() - daysSinceMonday)
    endDate = new Date(startDate)
    endDate.setDate(startDate.getDate() + 7)
  } else {
    startDate = new Date(year, month, 1)
    endDate = new Date(year, month + 1, 1)
  }

  return {
    start: startDate.getTime(),
    endExclusive: endDate.getTime(),
  }
}

function getSessionOverlapDuration(
  session: Session,
  range: PeriodRange,
  currentTime: number,
) {
  const startedAt = Date.parse(session.startedAt)
  const rawEndedAt = session.endedAt === null ? currentTime : Date.parse(session.endedAt)

  if (!Number.isFinite(startedAt) || !Number.isFinite(rawEndedAt)) {
    return 0
  }

  const overlapStart = Math.max(startedAt, range.start)
  const overlapEnd = Math.min(rawEndedAt, range.endExclusive, currentTime)

  return Math.max(0, overlapEnd - overlapStart)
}

export function calculateActivityStatistics({
  period,
  currentTime,
  activeSession,
  completedSessions,
  questHistories,
  quests,
}: StatisticsInput): ActivityStatistics {
  const range = getPeriodRange(period, currentTime)

  if (range === null) {
    return EMPTY_STATISTICS
  }

  const sessions = activeSession === null
    ? completedSessions
    : [...completedSessions, activeSession]
  const waitDuration = sessions.reduce(
    (total, session) => total + getSessionOverlapDuration(session, range, currentTime),
    0,
  )
  const completedQuestHistories = questHistories.filter((history) => {
    const completedAt = Date.parse(history.completedAt)

    return (
      history.completed &&
      Number.isFinite(completedAt) &&
      completedAt >= range.start &&
      completedAt < range.endExclusive &&
      completedAt <= currentTime
    )
  })
  const rewardByQuestId = new Map(quests.map((quest) => [quest.id, quest.reward]))
  const rewardPoints = completedQuestHistories.reduce(
    (total, history) => total + (rewardByQuestId.get(history.questId) ?? 0),
    0,
  )

  return {
    waitDuration,
    completedQuestCount: completedQuestHistories.length,
    rewardPoints,
    estimatedSavedMinutes: null,
  }
}
