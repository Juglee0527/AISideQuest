import { CircleDollarSign, ListTodo } from 'lucide-react'

import PageHeader from '../components/PageHeader'
import QuestCard from '../components/QuestCard'
import { useSession } from '../contexts/SessionContext'
import { mockQuests } from '../data/mockQuests'

function SideQuestPage() {
  const { activeSession } = useSession()

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Side Quest"
        title="짧은 시간도 의미 있게 사용하세요."
        description="AI 작업이 끝나기 전 완료할 수 있는 가벼운 활동을 선택할 수 있습니다."
        action={
          <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-400">
            <ListTodo size={17} aria-hidden="true" />
            이용 가능한 퀘스트 {mockQuests.length}개
          </div>
        }
      />

      <aside className="flex gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4 text-sm leading-6 text-amber-100/80">
        <CircleDollarSign className="mt-0.5 shrink-0 text-amber-300" size={19} aria-hidden="true" />
        <p>표시된 보상은 MVP 확인을 위한 예상 포인트이며 실제로 지급되지 않습니다.</p>
      </aside>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="사이드 퀘스트 목록">
        {mockQuests.map((quest, index) => (
          <QuestCard
            key={quest.id}
            quest={quest}
            sequence={index + 1}
            isSessionActive={activeSession !== null}
          />
        ))}
      </section>
    </div>
  )
}

export default SideQuestPage
