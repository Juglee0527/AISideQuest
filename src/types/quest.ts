export type QuestAttemptStatus =
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
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

export interface QuestAttempt {
  id: string
  aiSessionId: string
  status: QuestAttemptStatus
  startedAt: string
  submittedAt: string | null
  completedAt: string | null
  submissionDeadline: string | null
  canSubmit: boolean
  canRetry: boolean
  quest: {
    id: string
    code: string
    version: number
    title: string
    passScore: number
    rewardPoints: number
    retryAllowed: boolean
  }
  questions: Array<{
    id: string
    position: number
    prompt: string
    selectedOptionId: string | null
    options: Array<{
      id: string
      position: number
      label: string
    }>
  }>
  result: null | {
    score: number
    passed: boolean
    retryAllowed: boolean
    answerReview: null
  }
}
