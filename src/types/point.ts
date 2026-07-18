export interface PointLedgerEntry {
  id: string
  attemptId: string
  entryType: 'QUEST_REWARD'
  points: number
  description: string
  createdAt: string
  quest: {
    id: string
    code: string
    version: number
    title: string
  }
}

export interface PointLedgerPage {
  items: PointLedgerEntry[]
  nextCursor: string | null
}
