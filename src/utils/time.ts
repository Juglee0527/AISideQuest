export function getElapsedMilliseconds(startedAt: string, currentTime = Date.now()) {
  const startedTime = Date.parse(startedAt)

  if (Number.isNaN(startedTime) || !Number.isFinite(currentTime)) {
    return 0
  }

  return Math.max(0, currentTime - startedTime)
}

export function formatDuration(durationMilliseconds: number) {
  const safeDuration = Number.isFinite(durationMilliseconds)
    ? Math.max(0, durationMilliseconds)
    : 0
  const totalSeconds = Math.floor(safeDuration / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const paddedMinutes = String(minutes).padStart(2, '0')
  const paddedSeconds = String(seconds).padStart(2, '0')

  if (hours === 0) {
    return `${paddedMinutes}:${paddedSeconds}`
  }

  return `${String(hours).padStart(2, '0')}:${paddedMinutes}:${paddedSeconds}`
}

export function formatSummaryDuration(durationMilliseconds: number) {
  const safeDuration = Number.isFinite(durationMilliseconds)
    ? Math.max(0, durationMilliseconds)
    : 0

  if (safeDuration === 0) {
    return '0분'
  }

  if (safeDuration < 60_000) {
    return '1분 미만'
  }

  const totalMinutes = Math.floor(safeDuration / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) {
    return `${minutes}분`
  }

  if (minutes === 0) {
    return `${hours}시간`
  }

  return `${hours}시간 ${minutes}분`
}
