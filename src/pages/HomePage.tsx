import { ArrowRight, Clock3, Coins, Compass, Flag, Play, Square, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'

import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { useQuestHistory } from '../contexts/QuestHistoryContext'
import { useQuestCatalog } from '../contexts/QuestCatalogContext'
import { useSession } from '../contexts/SessionContext'
import useElapsedTime from '../hooks/useElapsedTime'
import { calculateActivityStatistics } from '../utils/statistics'
import { formatDuration, formatSummaryDuration } from '../utils/time'

function HomePage() {
  const {
    activeSession,
    completedSessions,
    loadStatus,
    mutationStatus,
    startSession,
    endSession,
    getCurrentTime,
  } = useSession()
  const { questHistories } = useQuestHistory()
  const { quests } = useQuestCatalog()
  const activeStartedAt = activeSession?.startedAt ?? null
  const elapsedMilliseconds = useElapsedTime(activeStartedAt, getCurrentTime)
  const lastCompletedSession = completedSessions[0]
  const isRunning = activeSession !== null
  const isWaitingForUser = activeSession?.status === 'WAITING_FOR_USER'
  const canMutate = loadStatus === 'ready' && mutationStatus === 'idle'
  const displayedDuration = isRunning
    ? elapsedMilliseconds
    : (lastCompletedSession?.durationMs ?? 0)
  const currentTime = activeStartedAt === null
    ? getCurrentTime()
    : Date.parse(activeStartedAt) + elapsedMilliseconds
  const todayStatistics = calculateActivityStatistics({
    period: 'today',
    currentTime,
    activeSession,
    completedSessions,
    questHistories,
    quests,
  })

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
                  <span
                    className={`size-2.5 rounded-full ${
                      isWaitingForUser
                        ? 'animate-pulse bg-amber-300'
                        : isRunning
                          ? 'animate-pulse bg-emerald-400'
                          : 'bg-slate-600'
                    }`}
                    aria-hidden="true"
                  />
                  {isWaitingForUser
                    ? 'Codex 확인 필요'
                    : isRunning
                      ? 'AI 작업 진행 중'
                      : '작업 대기 중'}
                </div>
              </div>
              <span
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  isWaitingForUser
                    ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                    : isRunning
                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-800/80 text-slate-400'
                }`}
              >
                {isWaitingForUser ? '사용자 응답 대기' : isRunning ? '측정 중' : '준비됨'}
              </span>
            </div>

            <div className="py-10 text-center sm:py-12">
              <p className="text-xs font-bold tracking-[0.2em] text-slate-500 uppercase">
                {isRunning ? 'Elapsed time' : lastCompletedSession ? 'Last session' : 'Elapsed time'}
              </p>
              <p
                className="mt-3 font-mono text-5xl font-bold tracking-tight text-white tabular-nums sm:text-7xl"
                role="timer"
                aria-label={`${Math.floor(displayedDuration / 1_000)}초`}
              >
                {formatDuration(displayedDuration)}
              </p>
              <p id="timer-description" className="mt-3 text-sm text-slate-500">
                {isRunning
                  ? '실제 시작 시각을 기준으로 경과 시간을 계산하고 있습니다.'
                  : lastCompletedSession
                    ? '최근 종료한 AI 작업 시간입니다.'
                    : 'AI 작업을 시작하면 시간이 표시됩니다.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void startSession()}
                disabled={!canMutate || isRunning}
                aria-describedby="timer-description"
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3.5 font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-400"
              >
                <Play size={18} fill="currentColor" aria-hidden="true" />
                {mutationStatus === 'starting' ? '시작 중...' : 'AI 작업 시작'}
              </button>
              <button
                type="button"
                onClick={() => void endSession()}
                disabled={!canMutate || !isRunning}
                aria-describedby="timer-description"
                className="flex items-center justify-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-5 py-3.5 font-bold text-rose-200 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
              >
                <Square size={17} fill="currentColor" aria-hidden="true" />
                {mutationStatus === 'ending' ? '종료 중...' : 'AI 작업 종료'}
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-slate-600">
              {isRunning
                ? '서버에 자동 저장되며 새로고침과 다른 로그인 기기에서도 이어집니다.'
                : '작업 기록은 로그인한 계정의 서버 데이터로 저장됩니다.'}
            </p>
          </div>
        </article>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <StatCard
            label="오늘 대기 시간"
            value={formatSummaryDuration(todayStatistics.waitDuration)}
            helper="진행 중인 AI 작업을 포함합니다."
            icon={Clock3}
            accent="sky"
          />
          <StatCard
            label="오늘 완료한 퀘스트"
            value={`${todayStatistics.completedQuestCount}개`}
            helper="퀘스트 완료 시각을 기준으로 계산합니다."
            icon={Trophy}
            accent="violet"
          />
          <StatCard
            label="예상 리워드"
            value={`${todayStatistics.rewardPoints.toLocaleString('ko-KR')}P`}
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
