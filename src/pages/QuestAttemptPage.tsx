import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Trophy,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiClientError } from '../api/apiClient'
import {
  getQuestAttempt,
  replaceQuestAnswers,
  startQuestAttempt,
  submitQuestAttempt,
} from '../api/questAttemptApi'
import { getQuest } from '../api/questApi'
import PageHeader from '../components/PageHeader'
import { useQuestCatalog } from '../contexts/QuestCatalogContext'
import { usePoints } from '../contexts/PointContext'
import { useSession } from '../contexts/SessionContext'
import type { Quest, QuestAttempt } from '../types/quest'

type LoadStatus = 'loading' | 'ready' | 'error'

function errorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) {
    return '퀴즈 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
  switch (error.code) {
    case 'ACTIVE_AI_SESSION_REQUIRED':
      return '퀴즈를 시작하려면 먼저 AI 작업 세션을 시작해 주세요.'
    case 'QUEST_ALREADY_PASSED':
      return '이미 통과한 퀘스트 버전은 다시 응시할 수 없습니다.'
    case 'QUEST_RETRY_NOT_ALLOWED':
      return '이 퀘스트는 실패 또는 만료 후 재응시할 수 없습니다.'
    case 'QUEST_ATTEMPT_EXPIRED':
      return '제출 가능 시간이 지나 응시가 만료되었습니다.'
    case 'QUEST_ATTEMPT_INCOMPLETE':
      return '모든 문제에 답한 뒤 제출해 주세요.'
    default:
      return error.message
  }
}

function QuestAttemptPage() {
  const { code = '', attemptId } = useParams()
  const navigate = useNavigate()
  const { activeSession } = useSession()
  const { refresh: refreshCatalog } = useQuestCatalog()
  const { refresh: refreshPoints } = usePoints()
  const [quest, setQuest] = useState<Quest | null>(null)
  const [attempt, setAttempt] = useState<QuestAttempt | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [mutation, setMutation] = useState<'idle' | 'starting' | 'saving' | 'submitting'>('idle')
  const [confirming, setConfirming] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading')
    setError(null)
    try {
      if (attemptId) {
        const attemptResult = await getQuestAttempt(attemptId, signal)
        const restored = attemptResult.data
        setAttempt(restored)
        setQuest({
          id: restored.quest.id,
          code: restored.quest.code,
          version: restored.quest.version,
          title: restored.quest.title,
          description: '응시 시작 시점에 고정된 퀘스트 버전입니다.',
          estimatedMinutes: 0,
          rewardPoints: restored.quest.rewardPoints,
          passScore: restored.quest.passScore,
          retryAllowed: restored.quest.retryAllowed,
          completionStatus: restored.result?.passed
            ? 'PASSED'
            : ['FAILED', 'EXPIRED'].includes(restored.status)
              ? 'FAILED'
              : 'IN_PROGRESS',
          latestAttempt: null,
        })
        setStatus('ready')
        return
      }
      const questResult = await getQuest(code, signal)
      setQuest(questResult.data)
      if (questResult.data.latestAttempt) {
        const attemptResult = await getQuestAttempt(
          questResult.data.latestAttempt.id,
          signal,
        )
        setAttempt(attemptResult.data)
      } else {
        setAttempt(null)
      }
      setStatus('ready')
    } catch (loadError) {
      if (loadError instanceof ApiClientError && loadError.code === 'REQUEST_ABORTED') return
      setError(errorMessage(loadError))
      setStatus('error')
    }
  }, [attemptId, code])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const answers = useMemo(() => attempt?.questions.flatMap((question) =>
    question.selectedOptionId === null
      ? []
      : [{ questionId: question.id, selectedOptionId: question.selectedOptionId }],
  ) ?? [], [attempt])
  const allAnswered = attempt !== null && answers.length === attempt.questions.length

  const start = async () => {
    setMutation('starting')
    setError(null)
    try {
      const result = await startQuestAttempt(attempt?.quest.code ?? code)
      setAttempt(result.data.attempt)
      navigate(`/quest-attempts/${result.data.attempt.id}`, { replace: true })
      setConfirming(false)
      setSavedAt(null)
      await refreshCatalog()
    } catch (startError) {
      setError(errorMessage(startError))
    } finally {
      setMutation('idle')
    }
  }

  const selectAnswer = async (questionId: string, selectedOptionId: string) => {
    if (!attempt || mutation !== 'idle') return
    const nextAnswers = attempt.questions.flatMap((question) => {
      const optionId = question.id === questionId
        ? selectedOptionId
        : question.selectedOptionId
      return optionId === null
        ? []
        : [{ questionId: question.id, selectedOptionId: optionId }]
    })
    setMutation('saving')
    setError(null)
    try {
      const result = await replaceQuestAnswers(attempt.id, nextAnswers)
      setAttempt(result.data)
      setSavedAt(new Date().toISOString())
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setMutation('idle')
    }
  }

  const submit = async () => {
    if (!attempt || !allAnswered) {
      setError('모든 문제에 답한 뒤 제출해 주세요.')
      return
    }
    setMutation('submitting')
    setError(null)
    try {
      const result = await submitQuestAttempt(attempt.id)
      setAttempt(result.data.attempt)
      setConfirming(false)
      await Promise.allSettled([refreshCatalog(), refreshPoints()])
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setMutation('idle')
    }
  }

  if (status === 'loading') {
    return (
      <section className="grid min-h-80 place-items-center" aria-live="polite">
        <span className="flex items-center gap-2 text-slate-400">
          <LoaderCircle className="animate-spin" size={20} aria-hidden="true" />
          저장된 응시를 불러오는 중입니다.
        </span>
      </section>
    )
  }

  if (status === 'error' || quest === null) {
    return (
      <section className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-6" role="alert">
        <p className="font-bold text-rose-100">퀴즈를 불러오지 못했습니다.</p>
        <p className="mt-2 text-sm text-rose-100/70">{error}</p>
        <button type="button" onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-rose-300/30 px-4 py-2 text-sm font-bold text-rose-100">
          <RefreshCw size={16} aria-hidden="true" /> 다시 시도
        </button>
      </section>
    )
  }

  const isFinished = attempt !== null
    && ['COMPLETED', 'FAILED', 'EXPIRED'].includes(attempt.status)

  return (
    <div className="space-y-8">
      <Link to="/quests" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white">
        <ArrowLeft size={16} aria-hidden="true" /> 퀘스트 목록
      </Link>
      <PageHeader
        eyebrow={`Quest · v${quest.version}`}
        title={quest.title}
        description={quest.description}
      />

      {error ? (
        <div className="flex gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-100" role="alert">
          <AlertCircle className="shrink-0" size={19} aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : null}

      {attempt === null ? (
        <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-7 text-center">
          <Trophy className="mx-auto text-emerald-300" size={36} aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold text-white">실제 개발 퀴즈를 시작합니다.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
            문제와 선택지는 시작 시점의 퀘스트 버전에 고정됩니다. 선택한 답은 즉시 서버에 저장되며, 채점은 제출할 때 서버에서만 수행합니다.
          </p>
          <button
            type="button"
            onClick={() => void start()}
            disabled={activeSession === null || mutation !== 'idle'}
            className="mt-6 rounded-xl bg-emerald-400 px-6 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation === 'starting' ? '응시 생성 중...' : activeSession ? '퀴즈 시작' : 'AI 세션 시작 후 응시 가능'}
          </button>
        </section>
      ) : isFinished ? (
        <section className={`rounded-3xl border p-7 text-center ${attempt.result?.passed ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-amber-400/20 bg-amber-400/5'}`}>
          {attempt.result?.passed ? (
            <CheckCircle2 className="mx-auto text-emerald-300" size={42} aria-hidden="true" />
          ) : (
            <XCircle className="mx-auto text-amber-300" size={42} aria-hidden="true" />
          )}
          <h2 className="mt-4 text-2xl font-bold text-white">
            {attempt.status === 'EXPIRED'
              ? '응시 시간이 만료되었습니다.'
              : attempt.result?.passed
                ? '퀘스트를 통과했습니다!'
                : '아쉽지만 통과하지 못했습니다.'}
          </h2>
          {attempt.result ? (
            <p className="mt-3 text-lg font-bold text-slate-200">
              점수 {attempt.result.score}점 · 통과 기준 {attempt.quest.passScore}점
            </p>
          ) : (
            <p className="mt-3 text-sm text-slate-400">만료된 응시는 채점하지 않습니다.</p>
          )}
          <p className="mt-3 text-sm text-slate-500">정답 선택지는 클라이언트에 공개하지 않습니다.</p>
          {attempt.canRetry ? (
            <button
              type="button"
              onClick={() => void start()}
              disabled={activeSession === null || mutation !== 'idle'}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-40"
            >
              <RotateCcw size={17} aria-hidden="true" />
              {activeSession ? '다시 응시' : '새 AI 세션 시작 후 재응시'}
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 text-sm">
            <span className="flex items-center gap-2 text-slate-300">
              <Clock3 size={17} aria-hidden="true" />
              {attempt.submissionDeadline
                ? `${new Date(attempt.submissionDeadline).toLocaleString('ko-KR')}까지 제출 가능`
                : 'AI 세션이 활성 상태인 동안 제출 가능'}
            </span>
            <span className="text-slate-500" aria-live="polite">
              {mutation === 'saving' ? '답안 저장 중...' : savedAt ? '모든 선택이 서버에 저장됨' : '선택 시 자동 저장'}
            </span>
          </div>

          <section className="space-y-5" aria-label="퀴즈 문제">
            {attempt.questions.map((question) => (
              <fieldset key={question.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6" disabled={mutation !== 'idle'}>
                <legend className="px-2 text-sm font-bold text-emerald-300">문제 {question.position}</legend>
                <p className="mt-2 text-lg font-semibold leading-7 text-white">{question.prompt}</p>
                <div className="mt-5 space-y-3">
                  {question.options.map((option) => (
                    <label key={option.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${question.selectedOptionId === option.id ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-slate-700 bg-slate-950/50 hover:border-slate-600'}`}>
                      <input
                        type="radio"
                        name={question.id}
                        value={option.id}
                        checked={question.selectedOptionId === option.id}
                        onChange={() => void selectAnswer(question.id, option.id)}
                        className="mt-1 accent-emerald-400"
                      />
                      <span className="text-sm leading-6 text-slate-200">{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!allAnswered || mutation !== 'idle' || !attempt.canSubmit}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={17} aria-hidden="true" /> 답안 제출
              </button>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-white">제출하면 답안을 수정할 수 없습니다. 채점할까요?</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirming(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">취소</button>
                  <button type="button" onClick={() => void submit()} disabled={mutation !== 'idle'} className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40">
                    {mutation === 'submitting' ? '채점 중...' : '최종 제출'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default QuestAttemptPage
