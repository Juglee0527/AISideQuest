import { Check, Clock3, Coins } from 'lucide-react'

import type { Quest } from '../types/quest'

interface QuestCardProps {
  quest: Quest
  sequence: number
  isSessionActive: boolean
}

function QuestCard({ quest, sequence, isSessionActive }: QuestCardProps) {
  return (
    <article className="group flex min-h-72 flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-black/10 transition hover:-translate-y-1 hover:border-emerald-400/30 hover:shadow-emerald-950/20">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-bold tracking-[0.16em] text-emerald-400 uppercase">
          Quest {String(sequence).padStart(2, '0')}
        </span>
        <span className="size-2 rounded-full bg-emerald-400/70" aria-hidden="true" />
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
          <dd className="mt-1.5 font-bold text-amber-300">{quest.reward.toLocaleString('ko-KR')}P</dd>
        </div>
      </dl>

      <button
        type="button"
        disabled
        aria-label={`${quest.title} 완료하기`}
        className="mt-5 flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-bold text-slate-500"
      >
        <Check size={17} aria-hidden="true" />
        {isSessionActive ? '완료 기능 준비 중' : '세션 시작 후 완료 가능'}
      </button>
    </article>
  )
}

export default QuestCard
