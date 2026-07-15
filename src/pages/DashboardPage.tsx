import { BarChart3, Clock3, Coins, TimerReset, Trophy } from 'lucide-react'
import { useState } from 'react'

import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'

const periods = [
  { id: 'today', label: '오늘' },
  { id: 'week', label: '이번 주' },
  { id: 'month', label: '이번 달' },
] as const

type PeriodId = (typeof periods)[number]['id']

function DashboardPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodId>('today')

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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="기간별 주요 통계">
        <StatCard
          label="총 AI 대기 시간"
          value="0분"
          helper="완료된 AI 작업 기준"
          icon={Clock3}
          accent="sky"
        />
        <StatCard
          label="완료한 퀘스트"
          value="0개"
          helper="완료 처리된 퀘스트 기준"
          icon={Trophy}
          accent="violet"
        />
        <StatCard
          label="누적 포인트"
          value="0P"
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
              대기 시간 활동
            </h2>
          </div>
          <span className="grid size-11 place-items-center rounded-xl bg-slate-800 text-slate-400">
            <BarChart3 size={21} aria-hidden="true" />
          </span>
        </div>

        <div className="mt-8 grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center">
          <div>
            <p className="font-semibold text-slate-300">아직 표시할 활동이 없습니다.</p>
            <p className="mt-2 text-sm text-slate-500">AI 작업을 완료하면 기간별 활동이 이곳에 표시됩니다.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

export default DashboardPage
