export interface StatisticsRow {
  as_of: Date
  time_zone: string
  time_zone_verified: boolean
  start_at: Date
  end_at: Date
  wait_duration_ms: string
  session_count: number
  degraded_session_count: number
  completed_quest_count: number
  points_earned: string
}

export interface StatisticsActivityRow {
  activity_type: 'AI_SESSION' | 'QUEST_COMPLETED'
  id: string
  occurred_at: Date
  duration_ms: string | null
  status: string | null
  timing_quality: 'EXACT' | 'DEGRADED' | null
  points: number | null
  quest_code: string | null
  quest_version: number | null
  quest_title: string | null
  as_of: Date
  time_zone: string
  time_zone_verified: boolean
  start_at: Date
  end_at: Date
}

export interface StatisticsCursor {
  occurredAt: string
  type: 'AI_SESSION' | 'QUEST_COMPLETED'
  id: string
}
