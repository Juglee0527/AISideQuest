import {
  AlertCircle,
  Cable,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiClientError } from '../api/apiClient'
import {
  approveBrowserDeviceLinkRequest,
  getBrowserDeviceLinkRequest,
} from '../api/deviceApi'
import { useSession } from '../contexts/SessionContext'
import type { BrowserDeviceLinkRequest } from '../types/device'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'DEVICE_LINK_REQUEST_NOT_FOUND') {
      return '연결 요청을 찾을 수 없습니다. Codex에서 연결을 다시 시작해 주세요.'
    }
    if (error.code === 'DEVICE_LINK_REQUEST_EXPIRED') {
      return '연결 요청이 만료되었습니다. Codex에서 연결을 다시 시작해 주세요.'
    }
    return error.message
  }

  return '연결 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

function DeviceConnectPage() {
  const { requestId = '' } = useParams()
  const { loadStatus } = useSession()
  const [linkRequest, setLinkRequest] = useState<BrowserDeviceLinkRequest | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isApproving, setIsApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loadStatus !== 'ready') {
      setIsLoading(loadStatus === 'loading')
      return undefined
    }

    const controller = new AbortController()
    setIsLoading(true)
    void getBrowserDeviceLinkRequest(requestId, controller.signal)
      .then((result) => {
        setLinkRequest(result.data.request)
        setError(null)
      })
      .catch((requestError) => {
        if (!(requestError instanceof ApiClientError && requestError.code === 'REQUEST_ABORTED')) {
          setError(errorMessage(requestError))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })

    return () => controller.abort()
  }, [loadStatus, requestId])

  const approve = async () => {
    setIsApproving(true)
    setError(null)

    try {
      const result = await approveBrowserDeviceLinkRequest(requestId)
      setLinkRequest(result.data.request)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setIsApproving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-bold tracking-[0.14em] text-emerald-400 uppercase">Codex plugin</p>
        <h1 className="mt-3 text-3xl font-bold text-white">AISideQuest 기기 연결</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          현재 Codex 설치를 로그인한 계정에 연결합니다. 프롬프트, 응답, 코드와 파일 경로는 수집하지 않습니다.
        </p>
      </div>

      {loadStatus === 'unauthenticated' ? (
        <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6 text-amber-100">
          <h2 className="font-bold">먼저 로그인해 주세요</h2>
          <p className="mt-2 text-sm text-amber-100/70">
            위의 GitHub 로그인 버튼을 누르면 로그인 후 이 승인 화면으로 자동 복귀합니다.
          </p>
        </section>
      ) : isLoading ? (
        <section className="flex items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 py-14 text-slate-400">
          <LoaderCircle className="animate-spin" size={20} aria-hidden="true" />
          연결 요청을 확인하는 중입니다.
        </section>
      ) : linkRequest?.status === 'APPROVED' ? (
        <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-7 text-center" aria-live="polite">
          <CheckCircle2 className="mx-auto text-emerald-300" size={44} aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold text-emerald-100">연결 승인 완료</h2>
          <p className="mt-2 text-sm text-emerald-100/70">
            Codex가 연결을 자동으로 마무리하고 있습니다. 이 창은 닫아도 됩니다.
          </p>
          <Link to="/devices" className="mt-6 inline-flex rounded-xl border border-emerald-300/30 px-4 py-2 text-sm font-bold text-emerald-200">
            연결된 기기 보기
          </Link>
        </section>
      ) : linkRequest?.status === 'EXPIRED' ? (
        <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6 text-amber-100">
          <div className="flex gap-3">
            <Clock3 className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
            <div>
              <h2 className="font-bold">연결 요청이 만료되었습니다</h2>
              <p className="mt-1 text-sm text-amber-100/70">Codex에서 “AISideQuest 연결해줘”라고 다시 요청해 주세요.</p>
            </div>
          </div>
        </section>
      ) : linkRequest ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7">
          <div className="flex items-start gap-3">
            <Cable className="mt-0.5 shrink-0 text-emerald-300" size={22} aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="font-bold text-white">이 기기를 연결할까요?</h2>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">기기 이름</dt>
                  <dd className="mt-1 break-words text-slate-200">{linkRequest.deviceName}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">플러그인 버전</dt>
                  <dd className="mt-1 text-slate-200">{linkRequest.pluginVersion}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">승인 가능 시간</dt>
                  <dd className="mt-1 text-slate-200">{formatDate(linkRequest.expiresAt)}까지</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-6 flex items-start gap-2 rounded-xl bg-slate-950/70 p-4 text-xs leading-5 text-slate-400">
            <ShieldCheck className="mt-0.5 shrink-0 text-slate-500" size={16} aria-hidden="true" />
            승인하면 이 기기에 90일 기기 토큰이 부여됩니다. 언제든 Devices 화면에서 즉시 연결을 해제할 수 있습니다.
          </div>

          <button
            type="button"
            disabled={isApproving}
            onClick={() => void approve()}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApproving ? <LoaderCircle className="animate-spin" size={17} aria-hidden="true" /> : <Cable size={17} aria-hidden="true" />}
            이 기기 연결 승인
          </button>
        </section>
      ) : null}

      {error ? (
        <section className="flex gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-5 text-rose-100" role="alert">
          <AlertCircle className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
          <p className="text-sm">{error}</p>
        </section>
      ) : null}
    </div>
  )
}

export default DeviceConnectPage
