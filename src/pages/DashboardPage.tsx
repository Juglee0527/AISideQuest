import { BarChart3, Clock3, Coins, TimerReset, Trophy } from 'lucide-react'
import { useState } from 'react'

import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { useQuestHistory } from '../contexts/QuestHistoryContext'
import { useSession } from '../contexts/SessionContext'
import { mockQuests } from '../data/mockQuests'
import useElapsedTime from '../hooks/useElapsedTime'
import {
  calculateActivityStatistics,
  type StatisticsPeriod,
} from '../utils/statistics'
import { formatSummaryDuration } from '../utils/time'

const periods: readonly { id: StatisticsPeriod; label: string }[] = [
  { id: 'today', label: '오늘' },
  { id: 'week', label: '이번 주' },
  { id: 'month', label: '이번 달' },
]

function DashboardPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<StatisticsPeriod>('today')
  const { activeSession, completedSessions } = useSession()
  const { questHistories } = useQuestHistory()
  const activeStartedAt = activeSession?.startedAt ?? null
  const elapsedMilliseconds = useElapsedTime(activeStartedAt)
  const currentTime = activeStartedAt === null
    ? Date.now()
    : Date.parse(activeStartedAt) + elapsedMilliseconds
  const statistics = calculateActivityStatistics({
    period: selectedPeriod,
    currentTime,
    activeSession,
    completedSessions,
    questHistories,
    quests: mockQuests,
  })
  const selectedPeriodLabel = periods.find((period) => period.id === selectedPeriod)?.label ?? ''
  const hasActivity = statistics.waitDuration > 0 || statistics.completedQuestCount > 0

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

      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label={`${selectedPeriodLabel} 주요 통계`}
        aria-live="polite"
      >
        <StatCard
          label="총 AI 대기 시간"
          value={formatSummaryDuration(statistics.waitDuration)}
          helper="진행 중인 AI 작업을 포함"
          icon={Clock3}
          accent="sky"
        />
        <StatCard
          label="완료한 퀘스트"
          value={`${statistics.completedQuestCount}개`}
          helper="완료 시각 기준"
          icon={Trophy}
          accent="violet"
        />
        <StatCard
          label="누적 포인트"
          value={`${statistics.rewardPoints.toLocaleString('ko-KR')}P`}
          helper="실제 지급이 아닌 예상 포인트"
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
          {hasActivity ? (
            <div className="max-w-xl">
              <p className="text-lg font-bold text-white">
                {formatSummaryDuration(statistics.waitDuration)}의 대기 시간을 기록했습니다.
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {selectedPeriodLabel} 동안 사이드 퀘스트 {statistics.completedQuestCount}개를 완료하고 예상 포인트{' '}
                {statistics.rewardPoints.toLocaleString('ko-KR')}P를 만들었습니다.
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
