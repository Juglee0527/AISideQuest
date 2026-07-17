import { AlertCircle, CircleDollarSign, ListTodo, LoaderCircle, RefreshCw } from 'lucide-react'

import PageHeader from '../components/PageHeader'
import QuestCard from '../components/QuestCard'
import { useQuestHistory } from '../contexts/QuestHistoryContext'
import { useQuestCatalog } from '../contexts/QuestCatalogContext'
import { useSession } from '../contexts/SessionContext'

function SideQuestPage() {
  const { activeSession } = useSession()
  const { questHistories, completeQuest } = useQuestHistory()
  const { quests, status, isRefreshing, errorMessage, refresh } = useQuestCatalog()
  const completedQuestIds = new Set(
    activeSession === null
      ? []
      : questHistories
          .filter((history) => history.sessionId === activeSession.id && history.completed)
          .map((history) => history.questId),
  )
  const completedCount = quests.filter(
    (quest) => quest.completionStatus === 'PASSED' || completedQuestIds.has(quest.id),
  ).length

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Side Quest"
        title="짧은 시간도 의미 있게 사용하세요."
        description="AI 작업이 끝나기 전 완료할 수 있는 가벼운 활동을 선택할 수 있습니다."
        action={
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-400"
              aria-live="polite"
            >
              <ListTodo size={17} aria-hidden="true" />
              {activeSession === null
                ? `이용 가능한 퀘스트 ${quests.length}개`
                : `현재 세션 ${completedCount}/${quests.length} 완료`}
              {isRefreshing ? <LoaderCircle className="animate-spin" size={15} aria-label="목록 갱신 중" /> : null}
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={status === 'loading' || isRefreshing}
              aria-label="퀘스트 목록 새로고침"
              className="grid size-10 place-items-center rounded-full border border-slate-800 bg-slate-900 text-slate-400 transition hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={isRefreshing ? 'animate-spin' : ''} size={17} aria-hidden="true" />
            </button>
          </div>
        }
      />

      <aside className="flex gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4 text-sm leading-6 text-amber-100/80">
        <CircleDollarSign className="mt-0.5 shrink-0 text-amber-300" size={19} aria-hidden="true" />
        <p>표시된 보상은 MVP 확인을 위한 예상 포인트이며 실제로 지급되지 않습니다.</p>
      </aside>

      {errorMessage !== null ? (
        <section className="flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-5" role="alert">
          <AlertCircle className="mt-0.5 shrink-0 text-rose-300" size={20} aria-hidden="true" />
          <div className="flex-1">
            <p className="font-bold text-rose-100">퀘스트 목록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-sm text-rose-100/70">{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-rose-200 hover:bg-rose-400/10 disabled:opacity-50"
          >
            <RefreshCw size={16} aria-hidden="true" />
            다시 시도
          </button>
        </section>
      ) : null}

      {status === 'loading' || status === 'idle' ? (
        <section className="grid min-h-64 place-items-center rounded-2xl border border-slate-800 bg-slate-900/50" aria-live="polite">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
            퀘스트 목록을 불러오는 중입니다.
          </div>
        </section>
      ) : status === 'ready' && quests.length === 0 ? (
        <section className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 text-center">
          <div>
            <p className="font-semibold text-slate-300">현재 공개된 퀘스트가 없습니다.</p>
            <p className="mt-2 text-sm text-slate-500">새 퀘스트가 준비되면 이곳에 표시됩니다.</p>
          </div>
        </section>
      ) : (
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="사이드 퀘스트 목록">
        {quests.map((quest, index) => (
          <QuestCard
            key={quest.id}
            quest={quest}
            sequence={index + 1}
            isSessionActive={activeSession !== null}
            isCompleted={quest.completionStatus === 'PASSED' || completedQuestIds.has(quest.id)}
            onComplete={() => completeQuest(quest.id)}
          />
        ))}
        </section>
      )}
    </div>
  )
}

export default SideQuestPage
