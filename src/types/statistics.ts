export type StatisticsPeriod = 'today' | 'week' | 'month' | 'custom'

export interface StatisticsSummary {
  period: StatisticsPeriod
  asOf: string
  timeZone: { id: string; verified: boolean }
  range: { startAt: string; endAt: string }
  ai: {
    waitDurationMs: number
    sessionCount: number
    degradedSessionCount: number
  }
  quests: { completedCount: number }
  points: { earned: number }
}

export type StatisticsActivity =
  | {
      type: 'AI_SESSION'
      id: string
      occurredAt: string
      durationMs: number
      status: string
      timingQuality: 'EXACT' | 'DEGRADED'
    }
  | {
      type: 'QUEST_COMPLETED'
      id: string
      occurredAt: string
      points: number
      quest: { code: string; version: number; title: string }
    }
