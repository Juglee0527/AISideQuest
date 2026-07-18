export type QuestAttemptStatus =
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'

export type QuestCompletionStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PASSED'
  | 'FAILED'

export interface QuestRow {
  id: string
  code: string
  version: number
  title: string
  description: string
  estimated_minutes: number
  reward_points: number
  pass_score: number
  retry_allowed: boolean
  published_at: Date
  attempt_id: string | null
  attempt_status: QuestAttemptStatus | null
  attempt_score: number | null
  attempt_passed: boolean | null
  attempt_started_at: Date | null
  attempt_completed_at: Date | null
}

export interface QuestAttemptSummary {
  id: string
  status: QuestAttemptStatus
  score: number | null
  passed: boolean | null
  startedAt: string
  completedAt: string | null
}

export interface QuestSnapshot {
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
