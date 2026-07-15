import { useEffect, useState } from 'react'

import { getElapsedMilliseconds } from '../utils/time'

function useElapsedTime(startedAt: string | null) {
  const [elapsedMilliseconds, setElapsedMilliseconds] = useState(0)

  useEffect(() => {
    if (startedAt === null) {
      setElapsedMilliseconds(0)
      return undefined
    }

    const updateElapsedTime = () => {
      setElapsedMilliseconds(getElapsedMilliseconds(startedAt))
    }

    updateElapsedTime()
    const intervalId = window.setInterval(updateElapsedTime, 1_000)

    return () => window.clearInterval(intervalId)
  }, [startedAt])

  return elapsedMilliseconds
}

export default useElapsedTime
