import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiClientError } from '../api/apiClient'
import { getStatisticsSummary, updateUserTimeZone } from '../api/statisticsApi'
import { useSession } from '../contexts/SessionContext'
import type { StatisticsPeriod, StatisticsSummary } from '../types/statistics'

export function browserTimeZone() {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

export function useStatisticsSummary(options: {
  period: StatisticsPeriod
  start?: string
  end?: string
}) {
  const { loadStatus } = useSession()
  const [summary, setSummary] = useState<StatisticsSummary | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [timeZoneError, setTimeZoneError] = useState<string | null>(null)
  const [isSavingTimeZone, setIsSavingTimeZone] = useState(false)
  const requestIdRef = useRef(0)
  const mountedRef = useRef(false)
  const autoTimeZoneAttemptedRef = useRef(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestIdRef.current
    setStatus('loading')
    setErrorMessage(null)
    try {
      let result = await getStatisticsSummary({ ...options, signal })
      if (
        !result.data.timeZone.verified
        && !autoTimeZoneAttemptedRef.current
      ) {
        autoTimeZoneAttemptedRef.current = true
        const detected = browserTimeZone()
        if (detected) {
          try {
            await updateUserTimeZone(detected)
            result = await getStatisticsSummary({ ...options, signal })
            setTimeZoneError(null)
          } catch (error) {
            if (!(error instanceof ApiClientError && error.code === 'REQUEST_ABORTED')) {
              setTimeZoneError(
                error instanceof ApiClientError
                  ? error.message
                  : '브라우저 시간대를 저장하지 못해 UTC를 사용합니다.',
              )
            }
          }
        } else {
          setTimeZoneError('브라우저 시간대를 확인할 수 없어 UTC를 사용합니다.')
        }
      }
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setSummary(result.data)
      setStatus('ready')
    } catch (error) {
      if (
        !mountedRef.current
        || requestId !== requestIdRef.current
        || (error instanceof ApiClientError && error.code === 'REQUEST_ABORTED')
      ) return
      setStatus('error')
      setErrorMessage(
        error instanceof ApiClientError
          ? error.message
          : '서버 통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      )
    }
  }, [options.end, options.period, options.start])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (loadStatus !== 'ready') {
      if (loadStatus === 'unauthenticated') {
        setSummary(null)
        setStatus('idle')
      }
      return undefined
    }
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, loadStatus])

  const saveTimeZone = useCallback(async (timeZone: string) => {
    setIsSavingTimeZone(true)
    setTimeZoneError(null)
    try {
      await updateUserTimeZone(timeZone)
      autoTimeZoneAttemptedRef.current = true
      await load()
      return true
    } catch (error) {
      setTimeZoneError(
        error instanceof ApiClientError
          ? error.message
          : '시간대를 저장하지 못했습니다.',
      )
      return false
    } finally {
      setIsSavingTimeZone(false)
    }
  }, [load])

  return {
    summary,
    status,
    errorMessage,
    timeZoneError,
    isSavingTimeZone,
    retry: () => load(),
    saveTimeZone,
  }
}
