import { Clock3, Compass, Gift, ListTodo } from 'lucide-react'

import PageHeader from '../components/PageHeader'

function SideQuestPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Side Quest"
        title="짧은 시간도 의미 있게 사용하세요."
        description="AI 작업이 끝나기 전 완료할 수 있는 가벼운 활동을 선택할 수 있습니다."
        action={
          <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-400">
            <ListTodo size={17} aria-hidden="true" />
            이용 가능한 퀘스트 0개
          </div>
        }
      />

      <section className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-16 text-center sm:px-10">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">
          <Compass size={30} aria-hidden="true" />
        </span>
        <h2 className="mt-6 text-xl font-bold text-white">퀘스트를 준비하고 있습니다.</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-400">
          다음 단계에서 설문조사, 개발 퀴즈, 학습 콘텐츠 등 더미 퀘스트 데이터가 이곳에 카드 형태로 표시됩니다.
        </p>
      </section>

      <section aria-labelledby="quest-card-guide-title">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-400">CARD GUIDE</p>
            <h2 id="quest-card-guide-title" className="mt-2 text-xl font-bold text-white">
              퀘스트 카드에서 확인할 정보
            </h2>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <span className="grid size-11 place-items-center rounded-xl bg-sky-400/10 text-sky-300">
              <Clock3 size={21} aria-hidden="true" />
            </span>
            <h3 className="mt-5 font-bold text-white">예상 소요 시간</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">현재 남은 대기 시간에 맞는 활동인지 판단할 수 있습니다.</p>
          </article>
          <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <span className="grid size-11 place-items-center rounded-xl bg-amber-400/10 text-amber-300">
              <Gift size={21} aria-hidden="true" />
            </span>
            <h3 className="mt-5 font-bold text-white">예상 보상</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">퀘스트 완료 시 적립될 더미 포인트를 확인할 수 있습니다.</p>
          </article>
        </div>
      </section>
    </div>
  )
}

export default SideQuestPage
