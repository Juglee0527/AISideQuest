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
import { getAllQuests } from '../api/questApi'
import type { Quest } from '../types/quest'
import { useSession } from './SessionContext'

export type QuestCatalogStatus = 'idle' | 'loading' | 'ready' | 'unauthenticated' | 'error'

interface QuestCatalogContextValue {
  quests: Quest[]
  status: QuestCatalogStatus
  isRefreshing: boolean
  errorMessage: string | null
  refresh: () => Promise<void>
}

const QuestCatalogContext = createContext<QuestCatalogContextValue | null>(null)

function message(error: unknown) {
  return error instanceof ApiClientError
    ? error.message
    : '퀘스트 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

export function QuestCatalogProvider({ children }: { children: ReactNode }) {
  const { loadStatus } = useSession()
  const [quests, setQuests] = useState<Quest[]>([])
  const [status, setStatus] = useState<QuestCatalogStatus>('idle')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const requestIdRef = useRef(0)
  const questsRef = useRef<Quest[]>([])

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestIdRef.current
    const hasData = questsRef.current.length > 0
    if (hasData) setIsRefreshing(true)
    else setStatus('loading')
    setErrorMessage(null)

    try {
      const result = await getAllQuests(signal)
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      questsRef.current = result.data
      setQuests(result.data)
      setStatus('ready')
    } catch (error) {
      if (
        !mountedRef.current
        || requestId !== requestIdRef.current
        || (error instanceof ApiClientError && error.code === 'REQUEST_ABORTED')
      ) return

      if (error instanceof ApiClientError && error.status === 401) {
        questsRef.current = []
        setQuests([])
        setStatus('unauthenticated')
      } else {
        setStatus(hasData ? 'ready' : 'error')
        setErrorMessage(message(error))
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (loadStatus === 'unauthenticated') {
      questsRef.current = []
      setQuests([])
      setStatus('unauthenticated')
      return undefined
    }

    if (loadStatus !== 'ready') return undefined
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, loadStatus])

  const refresh = useCallback(() => load(), [load])
  const value = useMemo(() => ({
    quests,
    status,
    isRefreshing,
    errorMessage,
    refresh,
  }), [quests, status, isRefreshing, errorMessage, refresh])

  return <QuestCatalogContext.Provider value={value}>{children}</QuestCatalogContext.Provider>
}

export function useQuestCatalog() {
  const context = useContext(QuestCatalogContext)
  if (!context) throw new Error('useQuestCatalog은 QuestCatalogProvider 내부에서 사용해야 합니다.')
  return context
}
