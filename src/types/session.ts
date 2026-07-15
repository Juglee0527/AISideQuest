export interface Session {
  id: string
  startedAt: string
  endedAt: string | null
  duration: number | null
}
