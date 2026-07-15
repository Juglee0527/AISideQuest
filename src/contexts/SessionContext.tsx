import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'

import type { Session } from '../types/session'
import {
  loadSessionState,
  saveSessionState,
  type PersistedSessionState,
} from '../storage/appStorage'
import { getElapsedMilliseconds } from '../utils/time'

type SessionState = PersistedSessionState

type SessionAction =
  | { type: 'start'; id: string; startedAt: string }
  | { type: 'end'; endedAt: string }

interface SessionContextValue extends SessionState {
  startSession: () => void
  endSession: () => void
}

interface SessionProviderProps {
  children: ReactNode
}

const initialSessionState: SessionState = {
  activeSession: null,
  completedSessions: [],
}

const SessionContext = createContext<SessionContextValue | null>(null)

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (action.type === 'start') {
    if (state.activeSession !== null) {
      return state
    }

    return {
      ...state,
      activeSession: {
        id: action.id,
        startedAt: action.startedAt,
        endedAt: null,
        duration: null,
      },
    }
  }

  if (state.activeSession === null) {
    return state
  }

  const completedSession: Session = {
    ...state.activeSession,
    endedAt: action.endedAt,
    duration: getElapsedMilliseconds(state.activeSession.startedAt, Date.parse(action.endedAt)),
  }

  return {
    activeSession: null,
    completedSessions: [completedSession, ...state.completedSessions],
  }
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [state, dispatch] = useReducer(
    sessionReducer,
    initialSessionState,
    () => loadSessionState() ?? initialSessionState,
  )

  useEffect(() => {
    saveSessionState(state)
  }, [state])

  const startSession = useCallback(() => {
    dispatch({
      type: 'start',
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    })
  }, [])

  const endSession = useCallback(() => {
    dispatch({ type: 'end', endedAt: new Date().toISOString() })
  }, [])

  const value = useMemo(
    () => ({ ...state, startSession, endSession }),
    [state, startSession, endSession],
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
