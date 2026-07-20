import type { SessionStatus } from '../sessions/session.types'

export type QuestAttemptStatus =
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'

export interface QuestAttemptRow {
  id: string
  user_id: string
  quest_id: string
  ai_session_id: string
  attempt_status: QuestAttemptStatus
  started_at: Date
  submitted_at: Date | null
  completed_at: Date | null
  score: number | null
  passed: boolean | null
  reward_points_snapshot: number | null
  code: string
  version: number
  title: string
  pass_score: number
  reward_points: number
  retry_allowed: boolean
  session_status: SessionStatus
  session_ended_at: Date | null
}

export interface QuestAttemptQuestionRow {
  question_id: string
  question_position: number
  prompt: string
  option_id: string
  option_position: number
  option_label: string
  selected_option_id: string | null
}

export interface QuestAttemptSnapshot {
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

export interface PointAwardSnapshot {
  ledgerEntryId: string
  points: number
}

export interface QuestAttemptSubmissionSnapshot {
  attempt: QuestAttemptSnapshot
  pointAward: PointAwardSnapshot | null
}
