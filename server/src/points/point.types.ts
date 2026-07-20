export interface PointBalanceRow {
  balance: string
}

export interface PointLedgerRow {
  id: string
  quest_attempt_id: string
  entry_type: 'QUEST_REWARD'
  points: number
  description: string
  created_at: Date
  quest_id: string
  quest_code: string
  quest_version: number
  quest_title: string
}

export interface PointLedgerCursor {
  createdAt: string
  id: string
}
