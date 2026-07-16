import { Archive, DatabaseZap, ShieldCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import {
  completeLegacyDataMigration,
  inspectLegacyData,
} from '../storage/appStorage'
import { formatSummaryDuration } from '../utils/time'

interface LegacyDataMigrationGateProps {
  children: ReactNode
}

function LegacyDataMigrationGate({ children }: LegacyDataMigrationGateProps) {
  const [inspection, setInspection] = useState(inspectLegacyData)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (inspection.status === 'none' || inspection.status === 'unavailable') {
    return children
  }

  const completeMigration = (mode: 'discarded' | 'referenced') => {
    setErrorMessage(null)

    if (!completeLegacyDataMigration(mode)) {
      setErrorMessage(
        '브라우저 저장소를 변경하지 못했습니다. 저장소 사용 권한을 확인한 뒤 다시 시도해 주세요.',
      )
      return
    }

    setInspection(inspectLegacyData())
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-5 py-12 text-slate-100">
      <section className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/30 sm:p-9" aria-labelledby="legacy-migration-title">
        <span className="grid size-12 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">
          <ShieldCheck size={24} aria-hidden="true" />
        </span>
        <p className="mt-6 text-sm font-bold tracking-[0.16em] text-emerald-400 uppercase">Data transition</p>
        <h1 id="legacy-migration-title" className="mt-2 text-2xl font-bold text-white sm:text-3xl">
          기존 MVP 기록을 처리해 주세요.
        </h1>

        {inspection.status === 'ready' ? (
          <>
            <p className="mt-4 leading-7 text-slate-400">
              이 브라우저에서 완료 세션 {inspection.completedSessionCount}개,
              퀘스트 완료 {inspection.completedQuestCount}개를 찾았습니다. 앞으로의 AI 세션은
              로그인한 계정의 서버 기록만 사용합니다.
            </p>
            <dl className="mt-6 grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-5 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold text-slate-500">완료 세션</dt>
                <dd className="mt-1 font-bold text-white">{inspection.completedSessionCount}개</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">참고 시간</dt>
                <dd className="mt-1 font-bold text-white">{formatSummaryDuration(inspection.totalDurationMs)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">퀘스트 완료</dt>
                <dd className="mt-1 font-bold text-white">{inspection.completedQuestCount}개</dd>
              </div>
            </dl>
            {inspection.hasActiveSession ? (
              <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-100/80">
                종료 시각이 없는 기존 활성 세션은 서버 세션으로 이어지지 않으며 참고 시간에도 포함하지 않습니다.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm leading-6 text-rose-100/80">
            기존 저장값이 손상되었거나 지원하지 않는 형식입니다. 잘못된 기록을 서버 상태에 섞지 않도록 초기화만 허용합니다.
          </p>
        )}

        <p className="mt-5 text-sm leading-6 text-slate-500">
          참고 기록은 이 브라우저에 요약만 보관되며 통계와 포인트에 반영되지 않습니다. 기존 예상 포인트는 실제 포인트로 이전하지 않습니다.
        </p>

        {errorMessage !== null ? (
          <p className="mt-5 text-sm font-semibold text-rose-300" role="alert">{errorMessage}</p>
        ) : null}

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => completeMigration('referenced')}
            disabled={inspection.status !== 'ready'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3.5 font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Archive size={18} aria-hidden="true" />
            참고 요약으로 보관
          </button>
          <button
            type="button"
            onClick={() => completeMigration('discarded')}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-5 py-3.5 font-bold text-slate-200 transition hover:bg-slate-700"
          >
            <DatabaseZap size={18} aria-hidden="true" />
            기존 기록 초기화
          </button>
        </div>
      </section>
    </main>
  )
}

export default LegacyDataMigrationGate
