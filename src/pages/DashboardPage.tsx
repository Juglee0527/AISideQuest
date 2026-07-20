import { Archive, BarChart3, Clock3, Coins, RefreshCw, TimerReset, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'

import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { usePoints } from '../contexts/PointContext'
import { browserTimeZone, useStatisticsSummary } from '../hooks/useStatisticsSummary'
import { loadLegacyReferenceSummary } from '../storage/appStorage'
import type { StatisticsPeriod } from '../types/statistics'
import { formatSummaryDuration } from '../utils/time'

const periods: readonly { id: StatisticsPeriod; label: string }[] = [
  { id: 'today', label: '오늘' },
  { id: 'week', label: '이번 주' },
  { id: 'month', label: '이번 달' },
  { id: 'custom', label: '직접 선택' },
]

function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function DashboardPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<StatisticsPeriod>('today')
  const [legacyReference] = useState(loadLegacyReferenceSummary)
  const [customEnd, setCustomEnd] = useState(() => dateInputValue(new Date(Date.now() + 86_400_000)))
  const [customStart, setCustomStart] = useState(() => dateInputValue(new Date(Date.now() - 6 * 86_400_000)))
  const [timeZoneInput, setTimeZoneInput] = useState('UTC')
  const { balance, ledger, status: pointStatus, errorMessage: pointError, refresh: refreshPoints } = usePoints()
  const statistics = useStatisticsSummary({
    period: selectedPeriod,
    start: selectedPeriod === 'custom' ? customStart : undefined,
    end: selectedPeriod === 'custom' ? customEnd : undefined,
  })
  const summary = statistics.summary
  useEffect(() => {
    if (summary) setTimeZoneInput(summary.timeZone.id)
  }, [summary])
  const selectedPeriodLabel = periods.find((period) => period.id === selectedPeriod)?.label ?? ''
  const hasActivity = (summary?.ai.waitDurationMs ?? 0) > 0 || (summary?.quests.completedCount ?? 0) > 0

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Dashboard"
        title="기다림이 만든 변화를 확인하세요."
        description="AI 대기 시간과 완료한 사이드 퀘스트를 기간별로 한눈에 확인할 수 있습니다."
      />

      <div
        className="inline-flex rounded-xl border border-slate-800 bg-slate-900 p-1"
        role="group"
        aria-label="통계 조회 기간"
      >
        {periods.map((period) => (
          <button
            key={period.id}
            type="button"
            aria-pressed={selectedPeriod === period.id}
            onClick={() => setSelectedPeriod(period.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              selectedPeriod === period.id
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {period.label}
          </button>
        ))}
      </div>

      {selectedPeriod === 'custom' ? (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <label className="text-sm text-slate-400">시작일
            <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200" />
          </label>
          <label className="text-sm text-slate-400">종료일(미포함)
            <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200" />
          </label>
        </div>
      ) : null}

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 lg:flex-row lg:items-end lg:justify-between" aria-labelledby="time-zone-title">
        <div>
          <h2 id="time-zone-title" className="font-bold text-white">통계 시간대</h2>
          <p className="mt-1 text-sm text-slate-400">현재 저장값: {summary?.timeZone.id ?? '확인 중'}</p>
          {(summary !== null && !summary.timeZone.verified) || statistics.timeZoneError ? (
            <p className="mt-2 text-sm text-amber-300" role="alert">
              {statistics.timeZoneError ?? '시간대가 확인되지 않아 UTC를 사용합니다. 올바른 IANA time zone을 저장해 주세요.'}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">IANA time zone
            <input value={timeZoneInput} onChange={(event) => setTimeZoneInput(event.target.value)} maxLength={100} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" />
          </label>
          <button type="button" onClick={() => setTimeZoneInput(browserTimeZone() ?? 'UTC')} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">브라우저 값</button>
          <button type="button" disabled={statistics.isSavingTimeZone} onClick={() => void statistics.saveTimeZone(timeZoneInput)} className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">
            {statistics.isSavingTimeZone ? '저장 중' : '저장'}
          </button>
        </div>
      </section>

      {statistics.status === 'error' ? (
        <section className="flex items-center justify-between gap-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-5" role="alert">
          <p className="text-sm text-rose-200">{statistics.errorMessage}</p>
          <button type="button" onClick={() => void statistics.retry()} className="inline-flex items-center gap-2 rounded-lg border border-rose-300/30 px-3 py-2 text-sm text-rose-100">
            <RefreshCw size={15} aria-hidden="true" /> 다시 시도
          </button>
        </section>
      ) : null}

      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label={`${selectedPeriodLabel} 주요 통계`}
        aria-live="polite"
      >
        <StatCard
          label="총 AI 대기 시간"
          value={statistics.status === 'loading' ? '불러오는 중' : formatSummaryDuration(summary?.ai.waitDurationMs ?? 0)}
          helper={summary?.ai.degradedSessionCount ? `복구된 저품질 세션 ${summary.ai.degradedSessionCount}개 포함` : '서버 시각 기준·활성 작업 포함'}
          icon={Clock3}
          accent="sky"
        />
        <StatCard
          label="완료한 퀘스트"
          value={statistics.status === 'loading' ? '불러오는 중' : `${summary?.quests.completedCount ?? 0}개`}
          helper="최초 통과 원장 생성 시각 기준"
          icon={Trophy}
          accent="violet"
        />
        <StatCard
          label="기간 획득 포인트"
          value={statistics.status === 'loading' ? '불러오는 중' : `${(summary?.points.earned ?? 0).toLocaleString('ko-KR')}P`}
          helper="선택 기간의 서버 원장 합계"
          icon={Coins}
          accent="amber"
        />
        <StatCard
          label="예상 절약 시간"
          value="-"
          helper="계산 기준 확정 후 제공"
          icon={TimerReset}
          accent="emerald"
        />
      </section>

      {legacyReference !== null ? (
        <aside className="flex gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-5 text-sm leading-6 text-slate-400">
          <Archive className="mt-0.5 shrink-0 text-slate-300" size={19} aria-hidden="true" />
          <p>
            이전 MVP 참고 기록: 완료 세션 {legacyReference.completedSessionCount}개,
            대기 시간 {formatSummaryDuration(legacyReference.totalDurationMs)},
            퀘스트 완료 {legacyReference.completedQuestCount}개입니다. 이 값은 현재 통계와 포인트에 합산하지 않습니다.
          </p>
        </aside>
      ) : null}

      <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8" aria-labelledby="point-ledger-title">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-300">POINT LEDGER</p>
            <h2 id="point-ledger-title" className="mt-2 text-xl font-bold text-white">최근 포인트 적립</h2>
            <p className="mt-1 text-sm text-slate-500">현재 잔액 {balance.toLocaleString('ko-KR')}P</p>
          </div>
          {pointStatus === 'error' ? (
            <button type="button" onClick={() => void refreshPoints()} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-amber-300/40">
              다시 시도
            </button>
          ) : null}
        </div>
        {pointStatus === 'loading' ? (
          <p className="mt-6 text-sm text-slate-400" role="status">포인트 원장을 불러오는 중입니다.</p>
        ) : pointStatus === 'error' ? (
          <p className="mt-6 text-sm text-rose-300" role="alert">{pointError}</p>
        ) : ledger.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">아직 적립된 포인트가 없습니다.</p>
        ) : (
          <ul className="mt-6 divide-y divide-slate-800">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div>
                  <p className="font-semibold text-slate-200">{entry.quest.title}</p>
                  <p className="mt-1 text-xs text-slate-500">v{entry.quest.version} · {new Date(entry.createdAt).toLocaleString('ko-KR')}</p>
                </div>
                <span className="font-bold text-amber-300">+{entry.points.toLocaleString('ko-KR')}P</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8" aria-labelledby="activity-title">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-400">ACTIVITY</p>
            <h2 id="activity-title" className="mt-2 text-xl font-bold text-white">
              {selectedPeriodLabel} 활동 요약
            </h2>
          </div>
          <span className="grid size-11 place-items-center rounded-xl bg-slate-800 text-slate-400">
            <BarChart3 size={21} aria-hidden="true" />
          </span>
        </div>

        <div className="mt-8 grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center">
          {statistics.status === 'loading' ? (
            <p className="text-sm text-slate-400" role="status">서버 통계를 불러오는 중입니다.</p>
          ) : hasActivity ? (
            <div className="max-w-xl">
              <p className="text-lg font-bold text-white">
                {formatSummaryDuration(summary?.ai.waitDurationMs ?? 0)}의 대기 시간을 기록했습니다.
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {selectedPeriodLabel} 동안 사이드 퀘스트 {summary?.quests.completedCount ?? 0}개를 최초 통과하고{' '}
                {(summary?.points.earned ?? 0).toLocaleString('ko-KR')}P를 적립했습니다.
              </p>
            </div>
          ) : (
            <div>
              <p className="font-semibold text-slate-300">아직 표시할 활동이 없습니다.</p>
              <p className="mt-2 text-sm text-slate-500">AI 작업을 시작하면 기간별 활동이 이곳에 표시됩니다.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default DashboardPage
