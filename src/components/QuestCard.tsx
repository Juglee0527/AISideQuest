import { Check, Clock3, Coins } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Quest } from '../types/quest'

interface QuestCardProps {
  quest: Quest
  sequence: number
}

function QuestCard({
  quest,
  sequence,
}: QuestCardProps) {
  const isCompleted = quest.completionStatus === 'PASSED'
  const hasActiveAttempt = quest.completionStatus === 'IN_PROGRESS'
  const actionLabel = isCompleted
    ? '결과 보기'
    : hasActiveAttempt
      ? '이어서 응시'
      : quest.completionStatus === 'FAILED'
        ? quest.retryAllowed ? '결과 및 재응시' : '결과 보기'
        : '퀴즈 시작'
  const actionPath = quest.latestAttempt
    ? `/quest-attempts/${quest.latestAttempt.id}`
    : `/quests/${quest.code}`

  return (
    <article
      className={`group flex min-h-72 flex-col rounded-2xl border p-6 shadow-lg transition ${
        isCompleted
          ? 'border-emerald-400/30 bg-emerald-400/5 shadow-emerald-950/20'
          : 'border-slate-800 bg-slate-900/70 shadow-black/10 hover:-translate-y-1 hover:border-emerald-400/30 hover:shadow-emerald-950/20'
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-bold tracking-[0.16em] text-emerald-400 uppercase">
          Quest {String(sequence).padStart(2, '0')}
        </span>
        {isCompleted ? (
          <span className="grid size-7 place-items-center rounded-full bg-emerald-400 text-slate-950">
            <Check size={16} strokeWidth={3} aria-hidden="true" />
          </span>
        ) : quest.completionStatus === 'IN_PROGRESS' ? (
          <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-xs font-bold text-sky-300">
            응시 진행 중
          </span>
        ) : quest.completionStatus === 'FAILED' ? (
          <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-300">
            {quest.retryAllowed ? '재도전 가능' : '응시 종료'}
          </span>
        ) : (
          <span className="size-2 rounded-full bg-emerald-400/70" aria-hidden="true" />
        )}
      </div>

      <h2 className="mt-5 text-xl font-bold tracking-tight text-white">{quest.title}</h2>
      <p className="mt-3 flex-1 text-sm leading-6 text-slate-400">{quest.description}</p>

      <dl className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-950/60 p-3">
          <dt className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock3 size={14} aria-hidden="true" />
            예상 시간
          </dt>
          <dd className="mt-1.5 font-bold text-slate-200">{quest.estimatedMinutes}분</dd>
        </div>
        <div className="rounded-xl bg-slate-950/60 p-3">
          <dt className="flex items-center gap-1.5 text-xs text-slate-500">
            <Coins size={14} aria-hidden="true" />
            예상 보상
          </dt>
          <dd className="mt-1.5 font-bold text-amber-300">{quest.rewardPoints.toLocaleString('ko-KR')}P</dd>
        </div>
      </dl>

      <Link
        to={actionPath}
        aria-label={`${quest.title} ${actionLabel}`}
        className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300"
      >
        <Check size={17} aria-hidden="true" />
        {actionLabel}
      </Link>
    </article>
  )
}

export default QuestCard
