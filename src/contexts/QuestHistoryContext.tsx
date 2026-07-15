import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'

import type { QuestHistory } from '../types/questHistory'
import { useSession } from './SessionContext'

interface QuestHistoryState {
  questHistories: QuestHistory[]
}

type QuestHistoryAction = {
  type: 'complete'
  history: QuestHistory
}

interface QuestHistoryContextValue extends QuestHistoryState {
  completeQuest: (questId: string) => void
}

interface QuestHistoryProviderProps {
  children: ReactNode
}

const initialQuestHistoryState: QuestHistoryState = {
  questHistories: [],
}

const QuestHistoryContext = createContext<QuestHistoryContextValue | null>(null)

function questHistoryReducer(
  state: QuestHistoryState,
  action: QuestHistoryAction,
): QuestHistoryState {
  const isAlreadyCompleted = state.questHistories.some(
    (history) =>
      history.sessionId === action.history.sessionId &&
      history.questId === action.history.questId &&
      history.completed,
  )

  if (isAlreadyCompleted) {
    return state
  }

  return {
    questHistories: [action.history, ...state.questHistories],
  }
}

export function QuestHistoryProvider({ children }: QuestHistoryProviderProps) {
  const { activeSession } = useSession()
  const [state, dispatch] = useReducer(questHistoryReducer, initialQuestHistoryState)

  const completeQuest = useCallback(
    (questId: string) => {
      if (activeSession === null || questId.trim() === '') {
        return
      }

      dispatch({
        type: 'complete',
        history: {
          id: crypto.randomUUID(),
          questId,
          sessionId: activeSession.id,
          completed: true,
          completedAt: new Date().toISOString(),
        },
      })
    },
    [activeSession],
  )

  const value = useMemo(
    () => ({ ...state, completeQuest }),
    [state, completeQuest],
  )

  return <QuestHistoryContext.Provider value={value}>{children}</QuestHistoryContext.Provider>
}

export function useQuestHistory() {
  const context = useContext(QuestHistoryContext)

  if (context === null) {
    throw new Error('useQuestHistory는 QuestHistoryProvider 내부에서 사용해야 합니다.')
  }

  return context
}
