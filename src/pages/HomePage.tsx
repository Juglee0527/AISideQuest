import { ArrowRight, Clock3, Coins, Compass, Flag, Play, Square, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'

import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'

function HomePage() {
  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Main Quest"
        title="AI가 일하는 동안, 기다림을 가치로 바꾸세요."
        description="AI 작업 시간을 측정하고, 짧은 사이드 퀘스트로 대기 시간을 의미 있게 채워보세요."
      />

      <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]" aria-label="AI 작업 현황">
        <article className="relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-slate-900 p-6 shadow-2xl shadow-emerald-950/20 sm:p-8">
          <div className="absolute -top-24 -right-24 size-72 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-400">현재 AI 상태</p>
                <div className="mt-2 flex items-center gap-2 text-lg font-bold text-white">
                  <span className="size-2.5 rounded-full bg-slate-600" aria-hidden="true" />
                  작업 대기 중
                </div>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-400">
                준비됨
              </span>
            </div>

            <div className="py-10 text-center sm:py-12">
              <p className="text-xs font-bold tracking-[0.2em] text-slate-500 uppercase">Elapsed time</p>
              <p className="mt-3 font-mono text-5xl font-bold tracking-tight text-white sm:text-7xl">00:00</p>
              <p className="mt-3 text-sm text-slate-500">작업을 시작하면 시간이 표시됩니다.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3.5 font-bold text-slate-950 opacity-60"
              >
                <Play size={18} fill="currentColor" aria-hidden="true" />
                AI 작업 시작
              </button>
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-5 py-3.5 font-bold text-slate-500"
              >
                <Square size={17} fill="currentColor" aria-hidden="true" />
                AI 작업 종료
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-slate-600">타이머 기능은 다음 개발 단계에서 연결됩니다.</p>
          </div>
        </article>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <StatCard
            label="오늘 대기 시간"
            value="0분"
            helper="완료된 AI 작업이 없습니다."
            icon={Clock3}
            accent="sky"
          />
          <StatCard
            label="오늘 완료한 퀘스트"
            value="0개"
            helper="첫 사이드 퀘스트를 시작해 보세요."
            icon={Trophy}
            accent="violet"
          />
          <StatCard
            label="예상 리워드"
            value="0P"
            helper="실제 지급이 아닌 예상 포인트입니다."
            icon={Coins}
            accent="amber"
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2" aria-label="빠른 메뉴">
        <Link
          to="/quests"
          className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-emerald-400/30 hover:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-5">
            <span className="grid size-11 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">
              <Compass size={21} aria-hidden="true" />
            </span>
            <ArrowRight className="text-slate-600 transition group-hover:translate-x-1 group-hover:text-emerald-300" size={20} aria-hidden="true" />
          </div>
          <h2 className="mt-6 text-lg font-bold text-white">사이드 퀘스트 둘러보기</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">대기 시간에 맞는 짧은 활동을 선택합니다.</p>
        </Link>

        <Link
          to="/dashboard"
          className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-sky-400/30 hover:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-5">
            <span className="grid size-11 place-items-center rounded-xl bg-sky-400/10 text-sky-300">
              <Flag size={21} aria-hidden="true" />
            </span>
            <ArrowRight className="text-slate-600 transition group-hover:translate-x-1 group-hover:text-sky-300" size={20} aria-hidden="true" />
          </div>
          <h2 className="mt-6 text-lg font-bold text-white">나의 기록 확인하기</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">대기 시간과 퀘스트 성과를 기간별로 확인합니다.</p>
        </Link>
      </section>
    </div>
  )
}

export default HomePage
