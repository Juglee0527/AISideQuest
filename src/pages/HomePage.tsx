import { ArrowRight, Bot, Clock3, Coins, Compass, Flag, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'

import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { useSession } from '../contexts/SessionContext'
import useElapsedTime from '../hooks/useElapsedTime'
import { useStatisticsSummary } from '../hooks/useStatisticsSummary'
import { formatDuration, formatSummaryDuration } from '../utils/time'
import type { Session } from '../types/session'

interface ActiveSessionCardProps {
  session: Session
  getCurrentTime: () => number
}

function ActiveSessionCard({ session, getCurrentTime }: ActiveSessionCardProps) {
  const elapsedMilliseconds = useElapsedTime(session.startedAt, getCurrentTime)
  const isWaitingForUser = session.status === 'WAITING_FOR_USER'
  const shortId = session.id.slice(0, 8).toUpperCase()

  return (
    <article className="rounded-2xl border border-slate-700/80 bg-slate-950/55 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${isWaitingForUser ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>
            <Bot size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold text-white">Codex 작업 {shortId}</p>
            <p className="mt-1 text-xs text-slate-500">작업 내용과 로컬 경로는 수집하지 않습니다.</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${isWaitingForUser ? 'border-amber-400/20 bg-amber-400/10 text-amber-200' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'}`}>
          {isWaitingForUser ? '확인 필요' : '진행 중'}
        </span>
      </div>

      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">Elapsed time</p>
          <p
            className="mt-2 font-mono text-3xl font-bold tracking-tight text-white tabular-nums sm:text-4xl"
            role="timer"
            aria-label={`Codex 작업 ${shortId}, ${Math.floor(elapsedMilliseconds / 1_000)}초 경과`}
          >
            {formatDuration(elapsedMilliseconds)}
          </p>
        </div>
        <span className={`size-2.5 shrink-0 rounded-full ${isWaitingForUser ? 'animate-pulse bg-amber-300' : 'animate-pulse bg-emerald-400'}`} aria-hidden="true" />
      </div>
    </article>
  )
}

function HomePage() {
  const {
    activeSessions,
    completedSessions,
    loadStatus,
    getCurrentTime,
  } = useSession()
  const statistics = useStatisticsSummary({ period: 'today' })
  const lastCompletedSession = completedSessions[0]
  const waitingCount = activeSessions.filter((session) => session.status === 'WAITING_FOR_USER').length
  const todayStatistics = statistics.summary

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
                <p className="text-sm font-medium text-slate-400">현재 AI 작업</p>
                <div className="mt-2 flex items-center gap-2 text-lg font-bold text-white">
                  <span
                    className={`size-2.5 rounded-full ${activeSessions.length > 0 ? 'animate-pulse bg-emerald-400' : 'bg-slate-600'}`}
                    aria-hidden="true"
                  />
                  {activeSessions.length > 0 ? `${activeSessions.length}개 작업 진행 중` : '작업 대기 중'}
                </div>
              </div>
              <span
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${waitingCount > 0 ? 'border-amber-400/20 bg-amber-400/10 text-amber-200' : activeSessions.length > 0 ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-slate-700 bg-slate-800/80 text-slate-400'}`}
              >
                {waitingCount > 0 ? `${waitingCount}개 확인 필요` : activeSessions.length > 0 ? '자동 측정 중' : loadStatus === 'loading' ? '동기화 중' : '준비됨'}
              </span>
            </div>

            {activeSessions.length > 0 ? (
              <div className="mt-7 grid gap-4 md:grid-cols-2">
                {activeSessions.map((session) => (
                  <ActiveSessionCard key={session.id} session={session} getCurrentTime={getCurrentTime} />
                ))}
              </div>
            ) : (
              <div className="py-10 text-center sm:py-12">
                <p className="text-xs font-bold tracking-[0.2em] text-slate-500 uppercase">
                  {lastCompletedSession ? 'Last session' : 'Automatic tracking'}
                </p>
                <p className="mt-3 font-mono text-5xl font-bold tracking-tight text-white tabular-nums sm:text-7xl">
                  {formatDuration(lastCompletedSession?.durationMs ?? 0)}
                </p>
                <p className="mt-3 text-sm text-slate-500">
                  {lastCompletedSession ? '최근 종료한 AI 작업 시간입니다.' : 'Codex 작업을 시작하면 자동으로 이곳에 표시됩니다.'}
                </p>
              </div>
            )}
            <p className="mt-5 text-center text-xs text-slate-600">
              시작과 종료는 Codex 상태에서 자동 감지되며 홈에서는 변경할 수 없습니다.
            </p>
          </div>
        </article>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <StatCard
            label="오늘 대기 시간"
            value={statistics.status === 'loading' ? '불러오는 중' : formatSummaryDuration(todayStatistics?.ai.waitDurationMs ?? 0)}
            helper="서버 시각과 저장된 시간대 기준입니다."
            icon={Clock3}
            accent="sky"
          />
          <StatCard
            label="오늘 완료한 퀘스트"
            value={statistics.status === 'loading' ? '불러오는 중' : `${todayStatistics?.quests.completedCount ?? 0}개`}
            helper="최초 통과 원장 생성 시각 기준입니다."
            icon={Trophy}
            accent="violet"
          />
          <StatCard
            label="오늘 획득 포인트"
            value={statistics.status === 'loading' ? '불러오는 중' : `${(todayStatistics?.points.earned ?? 0).toLocaleString('ko-KR')}P`}
            helper="오늘 생성된 서버 포인트 원장 합계입니다."
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
