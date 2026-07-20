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
import { getPointBalance, getPointLedger } from '../api/pointApi'
import type { PointLedgerEntry } from '../types/point'
import { useSession } from './SessionContext'

type PointStatus = 'idle' | 'loading' | 'ready' | 'unauthenticated' | 'error'

interface PointContextValue {
  balance: number
  ledger: PointLedgerEntry[]
  status: PointStatus
  errorMessage: string | null
  refresh: () => Promise<void>
}

const fallback: PointContextValue = {
  balance: 0,
  ledger: [],
  status: 'idle',
  errorMessage: null,
  refresh: async () => undefined,
}

const PointContext = createContext<PointContextValue | null>(null)

export function PointProvider({ children }: { children: ReactNode }) {
  const { loadStatus } = useSession()
  const [balance, setBalance] = useState(0)
  const [ledger, setLedger] = useState<PointLedgerEntry[]>([])
  const [status, setStatus] = useState<PointStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const requestIdRef = useRef(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestIdRef.current
    setStatus('loading')
    setErrorMessage(null)
    try {
      const [balanceResult, ledgerResult] = await Promise.all([
        getPointBalance(signal),
        getPointLedger({ limit: 10, signal }),
      ])
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setBalance(balanceResult.data.balance)
      setLedger(ledgerResult.data.items)
      setStatus('ready')
    } catch (error) {
      if (
        !mountedRef.current
        || requestId !== requestIdRef.current
        || (error instanceof ApiClientError && error.code === 'REQUEST_ABORTED')
      ) return
      if (error instanceof ApiClientError && error.status === 401) {
        setBalance(0)
        setLedger([])
        setStatus('unauthenticated')
      } else {
        setStatus('error')
        setErrorMessage(
          error instanceof ApiClientError
            ? error.message
            : '포인트 원장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        )
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
      setBalance(0)
      setLedger([])
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
    balance,
    ledger,
    status,
    errorMessage,
    refresh,
  }), [balance, ledger, status, errorMessage, refresh])

  return <PointContext.Provider value={value}>{children}</PointContext.Provider>
}

export function usePoints() {
  return useContext(PointContext) ?? fallback
}
