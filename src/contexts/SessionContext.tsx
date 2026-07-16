import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { ApiClientError } from '../api/apiClient'
import {
  endManualSession,
  getActiveSession,
  getAllSessionHistory,
  isActiveSession,
  startManualSession,
} from '../api/sessionApi'
import type { Session } from '../types/session'

export type SessionLoadStatus =
  | 'loading'
  | 'ready'
  | 'unauthenticated'
  | 'error'

export type SessionMutationStatus = 'idle' | 'starting' | 'ending'

interface SessionContextValue {
  activeSession: Session | null
  completedSessions: Session[]
  loadStatus: SessionLoadStatus
  mutationStatus: SessionMutationStatus
  errorMessage: string | null
  startSession: () => Promise<void>
  endSession: () => Promise<void>
  retry: () => Promise<void>
  getCurrentTime: () => number
}

interface SessionProviderProps {
  children: ReactNode
}

const SessionContext = createContext<SessionContextValue | null>(null)

function isUnauthorized(error: unknown) {
  return error instanceof ApiClientError && error.status === 401
}

function isAborted(error: unknown) {
  return error instanceof ApiClientError && error.code === 'REQUEST_ABORTED'
}

function getErrorMessage(error: unknown) {
  return error instanceof ApiClientError
    ? error.message
    : '세션 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

function selectTerminalSessions(sessions: Session[]) {
  return sessions.filter((session) => !isActiveSession(session))
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [activeSession, setActiveSessionState] = useState<Session | null>(null)
  const [completedSessions, setCompletedSessions] = useState<Session[]>([])
  const [loadStatus, setLoadStatus] = useState<SessionLoadStatus>('loading')
  const [mutationStatus, setMutationStatus] = useState<SessionMutationStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const activeSessionRef = useRef<Session | null>(null)
  const clockOffsetRef = useRef(0)
  const latestRequestRef = useRef(0)
  const pollInFlightRef = useRef(false)
  const mutationInFlightRef = useRef(false)
  const mountedRef = useRef(false)

  const setActiveSession = useCallback((session: Session | null) => {
    activeSessionRef.current = session
    setActiveSessionState(session)
  }, [])

  const updateServerClock = useCallback((serverTime: string) => {
    const serverTimestamp = Date.parse(serverTime)

    if (Number.isFinite(serverTimestamp)) {
      clockOffsetRef.current = serverTimestamp - Date.now()
    }
  }, [])

  const getCurrentTime = useCallback(
    () => Date.now() + clockOffsetRef.current,
    [],
  )

  const handleRequestError = useCallback(
    (error: unknown) => {
      if (!mountedRef.current || isAborted(error)) {
        return
      }

      if (isUnauthorized(error)) {
        setActiveSession(null)
        setCompletedSessions([])
        setLoadStatus('unauthenticated')
        setErrorMessage(null)
        return
      }

      setLoadStatus('error')
      setErrorMessage(getErrorMessage(error))
    },
    [setActiveSession],
  )

  const synchronizeAll = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++latestRequestRef.current

      try {
        const [activeResult, historyResult] = await Promise.all([
          getActiveSession(signal),
          getAllSessionHistory(signal),
        ])

        if (!mountedRef.current || requestId !== latestRequestRef.current) {
          return
        }

        updateServerClock(
          Date.parse(activeResult.serverTime) >= Date.parse(historyResult.serverTime)
            ? activeResult.serverTime
            : historyResult.serverTime,
        )
        setActiveSession(
          isActiveSession(activeResult.data) ? activeResult.data : null,
        )
        setCompletedSessions(selectTerminalSessions(historyResult.data))
        setLoadStatus('ready')
        setErrorMessage(null)
      } catch (error) {
        if (requestId === latestRequestRef.current) {
          handleRequestError(error)
        }
      }
    },
    [handleRequestError, setActiveSession, updateServerClock],
  )

  const refreshActiveSession = useCallback(async () => {
    if (pollInFlightRef.current || mutationInFlightRef.current) {
      return
    }

    pollInFlightRef.current = true
    const previousActiveSession = activeSessionRef.current
    const requestId = ++latestRequestRef.current

    try {
      const activeResult = await getActiveSession()

      if (!mountedRef.current || requestId !== latestRequestRef.current) {
        return
      }

      const nextActiveSession = isActiveSession(activeResult.data)
        ? activeResult.data
        : null
      const activeSessionChanged =
        previousActiveSession !== null &&
        previousActiveSession.id !== nextActiveSession?.id

      updateServerClock(activeResult.serverTime)
      setActiveSession(nextActiveSession)

      if (activeSessionChanged) {
        const historyResult = await getAllSessionHistory()

        if (!mountedRef.current || requestId !== latestRequestRef.current) {
          return
        }

        updateServerClock(historyResult.serverTime)
        setCompletedSessions(selectTerminalSessions(historyResult.data))
      }

      setLoadStatus('ready')
      setErrorMessage(null)
    } catch (error) {
      if (requestId === latestRequestRef.current) {
        handleRequestError(error)
      }
    } finally {
      pollInFlightRef.current = false
    }
  }, [handleRequestError, setActiveSession, updateServerClock])

  useEffect(() => {
    mountedRef.current = true
    const controller = new AbortController()

    void synchronizeAll(controller.signal)

    return () => {
      mountedRef.current = false
      latestRequestRef.current += 1
      controller.abort()
    }
  }, [synchronizeAll])

  useEffect(() => {
    if (loadStatus !== 'ready') {
      return undefined
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshActiveSession()
      }
    }
    const intervalId = window.setInterval(refreshWhenVisible, 5_000)

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadStatus, refreshActiveSession])

  const retry = useCallback(async () => {
    if (loadStatus === 'loading') {
      return
    }

    setLoadStatus('loading')
    setErrorMessage(null)
    await synchronizeAll()
  }, [loadStatus, synchronizeAll])

  const startSession = useCallback(async () => {
    if (
      loadStatus !== 'ready' ||
      mutationInFlightRef.current ||
      activeSessionRef.current !== null
    ) {
      return
    }

    mutationInFlightRef.current = true
    latestRequestRef.current += 1
    setMutationStatus('starting')
    setErrorMessage(null)

    try {
      const result = await startManualSession()

      if (!mountedRef.current) {
        return
      }

      updateServerClock(result.serverTime)
      setActiveSession(result.data.session)
      setLoadStatus('ready')
      await synchronizeAll()
    } catch (error) {
      handleRequestError(error)
    } finally {
      mutationInFlightRef.current = false

      if (mountedRef.current) {
        setMutationStatus('idle')
      }
    }
  }, [handleRequestError, loadStatus, setActiveSession, synchronizeAll, updateServerClock])

  const endSession = useCallback(async () => {
    const session = activeSessionRef.current

    if (
      loadStatus !== 'ready' ||
      mutationInFlightRef.current ||
      session === null
    ) {
      return
    }

    mutationInFlightRef.current = true
    latestRequestRef.current += 1
    setMutationStatus('ending')
    setErrorMessage(null)

    try {
      const result = await endManualSession(session.id)

      if (!mountedRef.current) {
        return
      }

      updateServerClock(result.serverTime)
      setActiveSession(null)
      setCompletedSessions((current) => [
        result.data.session,
        ...current.filter((item) => item.id !== result.data.session.id),
      ])
      setLoadStatus('ready')
      await synchronizeAll()
    } catch (error) {
      handleRequestError(error)
    } finally {
      mutationInFlightRef.current = false

      if (mountedRef.current) {
        setMutationStatus('idle')
      }
    }
  }, [handleRequestError, loadStatus, setActiveSession, synchronizeAll, updateServerClock])

  const value = useMemo(
    () => ({
      activeSession,
      completedSessions,
      loadStatus,
      mutationStatus,
      errorMessage,
      startSession,
      endSession,
      retry,
      getCurrentTime,
    }),
    [
      activeSession,
      completedSessions,
      loadStatus,
      mutationStatus,
      errorMessage,
      startSession,
      endSession,
      retry,
      getCurrentTime,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = useContext(SessionContext)

  if (context === null) {
    throw new Error('useSession은 SessionProvider 내부에서 사용해야 합니다.')
  }

  return context
}
