import { LoaderCircle, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  DISCOVER_INTEREST_TAGS,
  type DiscoverInterestTag,
} from '../types/discover'

export const INTEREST_LABELS: Record<DiscoverInterestTag, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  react: 'React',
  'node.js': 'Node.js',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  csharp: 'C#',
  cpp: 'C++',
  mobile: '모바일',
  devops: 'DevOps',
  cloud: '클라우드',
  data: '데이터',
  'ai-ml': 'AI·ML',
  security: '보안',
  databases: '데이터베이스',
  web: '웹 개발',
  testing: '테스트',
  'open-source': '오픈소스',
}

interface Props {
  tags: DiscoverInterestTag[]
  status: 'loading' | 'ready' | 'error'
  isSaving: boolean
  error: string | null
  onRetry: () => void
  onSave: (tags: DiscoverInterestTag[]) => Promise<void>
}

function DiscoverInterestSettings({
  tags,
  status,
  isSaving,
  error,
  onRetry,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<DiscoverInterestTag[]>(tags)
  const [selectionError, setSelectionError] = useState<string | null>(null)

  useEffect(() => setDraft(tags), [tags])

  const changed = useMemo(() => (
    draft.length !== tags.length || draft.some((tag, index) => tag !== tags[index])
  ), [draft, tags])

  const toggle = (tag: DiscoverInterestTag) => {
    setSelectionError(null)
    if (!draft.includes(tag) && draft.length >= 10) {
      setSelectionError('관심 기술은 최대 10개까지 선택할 수 있습니다.')
      return
    }
    setDraft((current) => {
      if (current.includes(tag)) return current.filter((value) => value !== tag)
      return DISCOVER_INTEREST_TAGS.filter((value) => (
        current.includes(value) || value === tag
      ))
    })
  }

  return (
    <details className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-slate-200">
        <span className="flex items-center gap-2">
          <SlidersHorizontal size={18} aria-hidden="true" /> 관심 기술 설정
        </span>
        <span className="text-xs font-semibold text-slate-500">{tags.length}개 선택</span>
      </summary>

      <div className="mt-5 border-t border-slate-800 pt-5">
        <p className="text-sm leading-6 text-slate-400">
          직접 선택한 기술만 정렬에 사용합니다. 프롬프트, 코드, 경로와 작업 내용은 사용하지 않습니다.
        </p>

        {status === 'loading' ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-slate-500" role="status">
            <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> 설정을 불러오는 중
          </p>
        ) : status === 'error' ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-rose-200" role="alert">
            <span>{error}</span>
            <button type="button" onClick={onRetry} className="font-bold underline underline-offset-4">
              다시 시도
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2" aria-label="관심 기술 선택">
              {DISCOVER_INTEREST_TAGS.map((tag) => {
                const selected = draft.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(tag)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                      selected
                        ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-200'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                    }`}
                  >
                    {INTEREST_LABELS[tag]}
                  </button>
                )
              })}
            </div>
            {selectionError ? <p className="mt-3 text-sm text-rose-300" role="alert">{selectionError}</p> : null}
            {error ? <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p> : null}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!changed || isSaving}
                onClick={() => void onSave(draft)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : null}
                {isSaving ? '저장 중' : '관심 기술 저장'}
              </button>
              <span className="text-xs text-slate-500">선택하지 않으면 기존 최신순으로 표시됩니다.</span>
            </div>
          </>
        )}
      </div>
    </details>
  )
}

export default DiscoverInterestSettings
