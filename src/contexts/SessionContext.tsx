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
  getActiveSessions,
  getAllSessionHistory,
  isActiveSession,
} from '../api/sessionApi'
import type { Session } from '../types/session'

export type SessionLoadStatus =
  | 'loading'
  | 'ready'
  | 'unauthenticated'
  | 'error'

interface SessionContextValue {
  activeSessions: Session[]
  activeSession: Session | null
  completedSessions: Session[]
  loadStatus: SessionLoadStatus
  errorMessage: string | null
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
  const [activeSessions, setActiveSessionsState] = useState<Session[]>([])
  const [completedSessions, setCompletedSessions] = useState<Session[]>([])
  const [loadStatus, setLoadStatus] = useState<SessionLoadStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const activeSessionsRef = useRef<Session[]>([])
  const clockOffsetRef = useRef(0)
  const latestRequestRef = useRef(0)
  const pollInFlightRef = useRef(false)
  const mountedRef = useRef(false)

  const setActiveSessions = useCallback((sessions: Session[]) => {
    activeSessionsRef.current = sessions
    setActiveSessionsState(sessions)
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
        setActiveSessions([])
        setCompletedSessions([])
        setLoadStatus('unauthenticated')
        setErrorMessage(null)
        return
      }

      setLoadStatus('error')
      setErrorMessage(getErrorMessage(error))
    },
    [setActiveSessions],
  )

  const synchronizeAll = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++latestRequestRef.current

      try {
        const [activeResult, historyResult] = await Promise.all([
          getActiveSessions(signal),
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
        setActiveSessions(activeResult.data)
        setCompletedSessions(selectTerminalSessions(historyResult.data))
        setLoadStatus('ready')
        setErrorMessage(null)
      } catch (error) {
        if (requestId === latestRequestRef.current) {
          handleRequestError(error)
        }
      }
    },
    [handleRequestError, setActiveSessions, updateServerClock],
  )

  const refreshActiveSession = useCallback(async () => {
    if (pollInFlightRef.current) {
      return
    }

    pollInFlightRef.current = true
    const previousActiveSessions = activeSessionsRef.current
    const requestId = ++latestRequestRef.current

    try {
      const activeResult = await getActiveSessions()

      if (!mountedRef.current || requestId !== latestRequestRef.current) {
        return
      }

      const nextActiveSessions = activeResult.data
      const previousIds = previousActiveSessions.map((session) => session.id).join(',')
      const nextIds = nextActiveSessions.map((session) => session.id).join(',')
      const activeSessionsChanged = previousIds !== nextIds

      updateServerClock(activeResult.serverTime)
      setActiveSessions(nextActiveSessions)

      if (activeSessionsChanged) {
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
  }, [handleRequestError, setActiveSessions, updateServerClock])

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

  const activeSession = activeSessions[0] ?? null
  const value = useMemo(
    () => ({
      activeSessions,
      activeSession,
      completedSessions,
      loadStatus,
      errorMessage,
      retry,
      getCurrentTime,
    }),
    [
      activeSessions,
      activeSession,
      completedSessions,
      loadStatus,
      errorMessage,
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
