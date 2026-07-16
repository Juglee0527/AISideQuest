import {
  Activity,
  AlertCircle,
  Cable,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ApiClientError } from '../api/apiClient'
import {
  createDeviceLink,
  createDeviceRotationLink,
  getDevices,
  revokeDevice,
} from '../api/deviceApi'
import PageHeader from '../components/PageHeader'
import { useSession } from '../contexts/SessionContext'
import type { Device, DeviceLink } from '../types/device'
import { getAutoDetectionSummary } from '../utils/autoDetectionStatus'

interface PendingLink extends DeviceLink {
  code: string
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getDeviceStatus(device: Device) {
  if (device.revokedAt !== null) {
    return { label: '폐기됨', className: 'bg-rose-400/10 text-rose-300' }
  }

  if (Date.parse(device.expiresAt) <= Date.now()) {
    return { label: '만료됨', className: 'bg-amber-400/10 text-amber-300' }
  }

  return { label: '활성', className: 'bg-emerald-400/10 text-emerald-300' }
}

function getErrorMessage(error: unknown) {
  return error instanceof ApiClientError
    ? error.message
    : '기기 연동 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

function DevicesPage() {
  const { loadStatus } = useSession()
  const [devices, setDevices] = useState<Device[]>([])
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [mutationId, setMutationId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const requestInFlightRef = useRef(false)

  const loadDevices = useCallback(async (
    signal?: AbortSignal,
    showLoading = true,
  ) => {
    if (requestInFlightRef.current) {
      return
    }

    requestInFlightRef.current = true

    if (showLoading) {
      setIsLoading(true)
    }

    try {
      const result = await getDevices(signal)
      setDevices(result.data.items)
      setErrorMessage(null)
    } catch (error) {
      if (!(error instanceof ApiClientError && error.code === 'REQUEST_ABORTED')) {
        setErrorMessage(getErrorMessage(error))
      }
    } finally {
      requestInFlightRef.current = false

      if (!signal?.aborted) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (loadStatus !== 'ready') {
      return undefined
    }

    const controller = new AbortController()
    void loadDevices(controller.signal)
    return () => controller.abort()
  }, [loadDevices, loadStatus])

  useEffect(() => {
    if (loadStatus !== 'ready') {
      return undefined
    }

    const controller = new AbortController()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadDevices(controller.signal, false)
      }
    }
    const intervalId = window.setInterval(refreshWhenVisible, 5_000)

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      controller.abort()
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadDevices, loadStatus])

  const issueLink = async (deviceId: string | null) => {
    const code = crypto.randomUUID()
    setMutationId(deviceId ?? 'new')
    setErrorMessage(null)

    try {
      const result = deviceId === null
        ? await createDeviceLink(code)
        : await createDeviceRotationLink(deviceId, code)

      setPendingLink({ ...result.data.link, code })
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setMutationId(null)
    }
  }

  const handleRevoke = async (device: Device) => {
    if (!window.confirm(`${device.name} 연결을 폐기하시겠습니까?`)) {
      return
    }

    setMutationId(device.id)
    setErrorMessage(null)

    try {
      const result = await revokeDevice(device.id)
      setDevices((current) => current.map((item) => (
        item.id === result.data.device.id ? result.data.device : item
      )))
      setPendingLink((current) => current?.deviceId === device.id ? null : current)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setMutationId(null)
    }
  }

  const connectCommand = pendingLink === null
    ? null
    : `node .\\scripts\\connect-device.mjs --code ${pendingLink.code}`
  const autoDetection = useMemo(
    () => getAutoDetectionSummary(devices),
    [devices],
  )
  const autoDetectionContent = autoDetection.status === 'MANUAL'
    ? {
        label: '수동 모드',
        description: '활성 플러그인 연결이 없습니다. Home에서 작업을 직접 시작하고 종료할 수 있습니다.',
        className: 'border-slate-700 bg-slate-900/60 text-slate-300',
      }
    : autoDetection.status === 'READY'
      ? {
          label: '자동 감지 준비',
          description: `활성 기기 ${autoDetection.activeDeviceCount}개가 연결되었습니다. 첫 lifecycle 이벤트를 기다립니다.`,
          className: 'border-amber-400/20 bg-amber-400/5 text-amber-200',
        }
      : {
          label: '자동 감지 이벤트 수신',
          description: `마지막 이벤트 ${formatDate(autoDetection.lastEventAt!)} · 활성 기기 ${autoDetection.activeDeviceCount}개`,
          className: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200',
        }

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Codex plugin"
        title="기기 연동"
        description="Codex 플러그인을 현재 계정에 연결하고, 기기 토큰을 재발급하거나 즉시 폐기할 수 있습니다."
        action={(
          <button
            type="button"
            disabled={loadStatus !== 'ready' || mutationId !== null}
            onClick={() => void issueLink(null)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutationId === 'new' ? (
              <LoaderCircle className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Cable size={17} aria-hidden="true" />
            )}
            새 기기 연결
          </button>
        )}
      />

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['1', '웹에서 일회용 연결 코드를 발급합니다.'],
          ['2', '플러그인에서 연결 명령을 한 번 실행합니다.'],
          ['3', '테스트 이벤트로 사용자 식별을 확인합니다.'],
        ].map(([step, description]) => (
          <div key={step} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <span className="grid size-8 place-items-center rounded-full bg-emerald-400/10 text-sm font-bold text-emerald-300">{step}</span>
            <p className="mt-4 text-sm leading-6 text-slate-300">{description}</p>
          </div>
        ))}
      </section>

      <section className={`flex items-start gap-3 rounded-2xl border p-5 ${autoDetectionContent.className}`} aria-live="polite">
        <Activity className="mt-0.5 shrink-0" size={21} aria-hidden="true" />
        <div>
          <h2 className="font-bold">{autoDetectionContent.label}</h2>
          <p className="mt-1 text-sm opacity-75">{autoDetectionContent.description}</p>
          {autoDetection.status === 'RECEIVING' ? (
            <p className="mt-2 text-xs opacity-60">실시간 온라인 여부와 장애 판정은 다음 heartbeat 단계에서 추가합니다.</p>
          ) : null}
        </div>
      </section>

      {pendingLink !== null && connectCommand !== null ? (
        <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-6" aria-live="polite">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 shrink-0 text-emerald-300" size={21} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-emerald-100">
                {pendingLink.purpose === 'CONNECT' ? '기기 연결 코드' : '기기 재연결 코드'}
              </h2>
              <p className="mt-1 text-sm text-emerald-100/70">
                {formatDate(pendingLink.expiresAt)}까지 한 번만 사용할 수 있습니다.
              </p>
              <code className="mt-4 block overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 text-sm text-emerald-200">
                {connectCommand}
              </code>
              <code className="mt-2 block overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-300">
                node .\scripts\send-test-event.mjs
              </code>
            </div>
          </div>
        </section>
      ) : null}

      {errorMessage !== null ? (
        <section className="flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-5" role="alert">
          <AlertCircle className="mt-0.5 shrink-0 text-rose-300" size={20} aria-hidden="true" />
          <div className="flex-1">
            <p className="font-bold text-rose-100">기기 요청을 처리하지 못했습니다.</p>
            <p className="mt-1 text-sm text-rose-100/70">{errorMessage}</p>
          </div>
          <button type="button" onClick={() => void loadDevices()} className="text-rose-200" aria-label="기기 목록 다시 불러오기">
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      <section>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold tracking-[0.14em] text-slate-500 uppercase">Connected devices</p>
            <h2 className="mt-2 text-2xl font-bold text-white">연결된 기기</h2>
          </div>
          <ShieldCheck className="text-slate-600" size={28} aria-hidden="true" />
        </div>

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-slate-800 py-12 text-sm text-slate-400">
            <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
            기기 목록을 불러오는 중입니다.
          </div>
        ) : devices.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
            아직 연결된 기기가 없습니다.
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {devices.map((device) => {
              const status = getDeviceStatus(device)
              const isActive = device.revokedAt === null

              return (
                <article key={device.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-white">{device.name}</h3>
                      <p className="mt-1 text-xs text-slate-500">Plugin {device.pluginVersion ?? '버전 미상'}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
                  </div>
                  <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">마지막 이벤트</dt>
                      <dd className="mt-1 text-slate-300">{device.lastSeenAt === null ? '아직 없음' : formatDate(device.lastSeenAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">토큰 만료</dt>
                      <dd className="mt-1 text-slate-300">{formatDate(device.expiresAt)}</dd>
                    </div>
                  </dl>
                  {isActive ? (
                    <div className="mt-6 flex gap-2">
                      <button
                        type="button"
                        disabled={mutationId !== null}
                        onClick={() => void issueLink(device.id)}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                      >
                        <RotateCw size={15} aria-hidden="true" />
                        재연결
                      </button>
                      <button
                        type="button"
                        disabled={mutationId !== null}
                        onClick={() => void handleRevoke(device)}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-400/20 px-3 py-2 text-sm font-bold text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-50"
                      >
                        <Unplug size={15} aria-hidden="true" />
                        연결 폐기
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default DevicesPage
