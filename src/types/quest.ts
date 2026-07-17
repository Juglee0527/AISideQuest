export type QuestAttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'COMPLETED' | 'FAILED'
export type QuestCompletionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED'

export interface QuestAttemptSummary {
  id: string
  status: QuestAttemptStatus
  score: number | null
  passed: boolean | null
  startedAt: string
  completedAt: string | null
}

export interface Quest {
  id: string
  code: string
  version: number
  title: string
  description: string
  estimatedMinutes: number
  rewardPoints: number
  passScore: number
  retryAllowed: boolean
  completionStatus: QuestCompletionStatus
  latestAttempt: QuestAttemptSummary | null
}
