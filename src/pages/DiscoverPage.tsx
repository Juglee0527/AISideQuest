import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  BriefcaseBusiness,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
  Newspaper,
  RefreshCw,
  SearchX,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { ApiClientError } from '../api/apiClient'
import {
  deleteSavedDiscoverItem,
  getDiscoverPage,
  getSavedDiscoverItems,
  saveDiscoverItem,
} from '../api/discoverApi'
import PageHeader from '../components/PageHeader'
import { useSession } from '../contexts/SessionContext'
import type {
  DiscoverCategory,
  DiscoverItem,
  DiscoverKind,
  DiscoverSavedItem,
  DiscoverSourceSnapshot,
} from '../types/discover'

const PAGE_SIZE = 20

const TABS: readonly {
  category: DiscoverCategory
  label: string
  description: string
  icon: typeof BriefcaseBusiness
}[] = [
  {
    category: 'EARNING',
    label: '수익 기회',
    description: '원격 채용·계약 기회를 확인하세요.',
    icon: BriefcaseBusiness,
  },
  {
    category: 'NEWS',
    label: '개발 소식',
    description: '새로운 개발 글과 프로젝트 소식을 살펴보세요.',
    icon: Newspaper,
  },
  {
    category: 'COMMUNITY',
    label: '커뮤니티',
    description: '개발자 질문과 토론을 둘러보세요.',
    icon: MessageCircle,
  },
]

const KIND_LABELS: Record<DiscoverKind, string> = {
  PAID_JOB: '채용·계약 기회',
  CASH_BOUNTY: '현금 바운티',
  REPUTATION_BOUNTY: '평판 바운티',
  OSS_TASK: '오픈소스 기회',
  ARTICLE: '개발 글',
  DISCUSSION: '토론',
}

type PageStatus = 'idle' | 'loading' | 'ready' | 'error'

function errorMessage(error: unknown) {
  return error instanceof ApiClientError
    ? error.message
    : 'Discover 항목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

function formatDate(value: string | null) {
  if (value === null) return null
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatCashReward(amountMinor: number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    })
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
    return formatter.format(amountMinor / (10 ** fractionDigits))
  } catch {
    return `${currency} ${amountMinor.toLocaleString('ko-KR')} (최소 통화 단위)`
  }
}

function valueLabel(item: DiscoverItem) {
  if (item.reward?.type === 'CASH_BOUNTY') {
    return `검증된 바운티 ${formatCashReward(item.reward.amountMinor, item.reward.currency)}`
  }
  if (item.reward?.type === 'REPUTATION_BOUNTY') {
    return `평판 보상 ${item.reward.amount.toLocaleString('ko-KR')}`
  }
  if (item.compensation?.provided) {
    return `출처 제공 급여 · ${item.compensation.text}`
  }
  if (item.kind === 'PAID_JOB') {
    return '급여 정보 미제공'
  }
  return null
}

function mergeItems(current: DiscoverItem[], incoming: DiscoverItem[]) {
  const knownIds = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !knownIds.has(item.id))]
}

function mergeSavedItems(current: DiscoverSavedItem[], incoming: DiscoverSavedItem[]) {
  const knownIds = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !knownIds.has(item.id))]
}

function DiscoverCard({
  item,
  savedItemId,
  isSaving,
  onToggleSaved,
}: {
  item: DiscoverItem
  savedItemId: string | null
  isSaving: boolean
  onToggleSaved: () => void
}) {
  const publishedLabel = formatDate(item.publishedAt)
  const itemValue = valueLabel(item)

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-sm transition-colors hover:border-slate-700 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-300">
          {KIND_LABELS[item.kind]}
        </span>
        <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">
          {item.attribution}
        </span>
      </div>

      <h2 className="mt-4 text-lg font-bold leading-7 text-white">{item.title}</h2>
      {item.summary ? (
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-400">{item.summary}</p>
      ) : null}

      {itemValue ? (
        <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-sm font-semibold text-amber-200">
          {itemValue}
        </p>
      ) : null}

      {item.tags.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="기술 및 유형 태그">
          {item.tags.map((tag) => (
            <li key={tag} className="rounded-lg bg-slate-800/80 px-2.5 py-1 text-xs text-slate-400">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock3 size={14} aria-hidden="true" />
          {publishedLabel ? (
            <time dateTime={item.publishedAt ?? undefined}>{publishedLabel}</time>
          ) : (
            '게시일 미제공'
          )}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={isSaving}
            onClick={onToggleSaved}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3.5 py-2 text-sm font-bold text-slate-200 transition hover:border-emerald-300/50 hover:text-emerald-200 disabled:cursor-wait disabled:opacity-60"
            aria-label={`${item.title} ${savedItemId ? '저장 취소' : '저장'}`}
          >
            {isSaving ? (
              <LoaderCircle className="animate-spin" size={15} aria-hidden="true" />
            ) : savedItemId ? (
              <BookmarkCheck size={15} aria-hidden="true" />
            ) : (
              <Bookmark size={15} aria-hidden="true" />
            )}
            {isSaving ? '처리 중' : savedItemId ? '저장됨' : '저장'}
          </button>
          <a
            href={item.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3.5 py-2 text-sm font-bold text-slate-200 transition hover:border-emerald-300/50 hover:text-emerald-200"
            aria-label={`${item.title} 원문 보기 (${item.attribution})`}
          >
            원문 보기
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  )
}

function SourceNotice({
  sources,
  onRetry,
}: {
  sources: DiscoverSourceSnapshot[]
  onRetry: () => void
}) {
  const enabledSources = sources.filter((source) => source.enabled)
  const staleSources = enabledSources.filter((source) => source.status === 'STALE')
  const unavailableSources = enabledSources.filter((source) => source.status === 'UNAVAILABLE')
  const availableSources = enabledSources.filter((source) => source.status !== 'UNAVAILABLE')

  if (enabledSources.length > 0 && availableSources.length === 0) {
    return (
      <section className="flex flex-col gap-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-5 sm:flex-row sm:items-center sm:justify-between" role="alert">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-rose-300" size={20} aria-hidden="true" />
          <div>
            <p className="font-bold text-rose-100">현재 이 탭의 정보를 불러올 수 없습니다.</p>
            <p className="mt-1 text-sm leading-6 text-rose-100/70">
              {unavailableSources.map((source) => source.displayName).join(', ')} 연결이 복구된 뒤 다시 시도해 주세요.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-rose-300/30 px-3.5 py-2 text-sm font-bold text-rose-100 hover:bg-rose-300/10"
        >
          <RefreshCw size={15} aria-hidden="true" /> 다시 시도
        </button>
      </section>
    )
  }

  if (staleSources.length === 0 && unavailableSources.length === 0) return null

  return (
    <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4" role="status">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-amber-300" size={18} aria-hidden="true" />
        <p className="text-sm leading-6 text-amber-100/80">
          {staleSources.length > 0
            ? `${staleSources.map((source) => source.displayName).join(', ')}는 마지막으로 확인된 정보를 표시하고 있습니다.`
            : null}
          {staleSources.length > 0 && unavailableSources.length > 0 ? ' ' : null}
          {unavailableSources.length > 0
            ? `${unavailableSources.map((source) => source.displayName).join(', ')} 항목은 현재 제외되었습니다.`
            : null}
        </p>
      </div>
    </section>
  )
}

function SourceStatusList({ sources }: { sources: DiscoverSourceSnapshot[] }) {
  const enabledSources = sources.filter((source) => source.enabled)
  if (enabledSources.length === 0) return null

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Source 갱신 상태">
      {enabledSources.map((source) => {
        const statusLabel = source.status === 'FRESH'
          ? '최신'
          : source.status === 'STALE'
            ? '마지막 확인 정보'
            : '사용 불가'
        return (
          <li
            key={source.source}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              source.status === 'FRESH'
                ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200'
                : source.status === 'STALE'
                  ? 'border-amber-400/20 bg-amber-400/5 text-amber-200'
                  : 'border-rose-400/20 bg-rose-400/5 text-rose-200'
            }`}
          >
            {source.displayName} · {statusLabel}
            {source.fetchedAt ? ` · ${formatDateTime(source.fetchedAt)}` : null}
          </li>
        )
      })}
    </ul>
  )
}

function DiscoverPage() {
  const { loadStatus: sessionStatus } = useSession()
  const [view, setView] = useState<'EXPLORE' | 'SAVED'>('EXPLORE')
  const [category, setCategory] = useState<DiscoverCategory>('EARNING')
  const [items, setItems] = useState<DiscoverItem[]>([])
  const [sources, setSources] = useState<DiscoverSourceSnapshot[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [pageStatus, setPageStatus] = useState<PageStatus>('idle')
  const [pageError, setPageError] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [savedReferences, setSavedReferences] = useState<Record<string, string>>({})
  const [savedItems, setSavedItems] = useState<DiscoverSavedItem[]>([])
  const [savedNextCursor, setSavedNextCursor] = useState<string | null>(null)
  const [savedStatus, setSavedStatus] = useState<PageStatus>('idle')
  const [savedError, setSavedError] = useState<string | null>(null)
  const [isLoadingMoreSaved, setIsLoadingMoreSaved] = useState(false)
  const [savedLoadMoreError, setSavedLoadMoreError] = useState<string | null>(null)
  const [savedReloadKey, setSavedReloadKey] = useState(0)
  const [savingItemIds, setSavingItemIds] = useState<Set<string>>(() => new Set())
  const [mutationError, setMutationError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const savedRequestSequence = useRef(0)

  useEffect(() => {
    if (sessionStatus !== 'ready' || view !== 'EXPLORE') return undefined

    const sequence = ++requestSequence.current
    const controller = new AbortController()
    setPageStatus('loading')
    setPageError(null)
    setItems([])
    setSources([])
    setNextCursor(null)
    setLoadMoreError(null)

    void getDiscoverPage({ category, limit: PAGE_SIZE, signal: controller.signal })
      .then((result) => {
        if (sequence !== requestSequence.current) return
        setItems(result.data.items)
        setSources(result.data.sources)
        setNextCursor(result.data.nextCursor)
        setSavedReferences(Object.fromEntries(
          result.data.savedItems.map((item) => [item.itemId, item.savedItemId]),
        ))
        setPageStatus('ready')
      })
      .catch((error: unknown) => {
        if (
          sequence !== requestSequence.current
          || (error instanceof ApiClientError && error.code === 'REQUEST_ABORTED')
        ) return
        setPageError(errorMessage(error))
        setPageStatus('error')
      })

    return () => controller.abort()
  }, [category, reloadKey, sessionStatus, view])

  useEffect(() => {
    if (sessionStatus !== 'ready' || view !== 'SAVED') return undefined

    const sequence = ++savedRequestSequence.current
    const controller = new AbortController()
    setSavedStatus('loading')
    setSavedError(null)
    setSavedItems([])
    setSavedNextCursor(null)
    setSavedLoadMoreError(null)

    void getSavedDiscoverItems({ limit: PAGE_SIZE, signal: controller.signal })
      .then((result) => {
        if (sequence !== savedRequestSequence.current) return
        setSavedItems(result.data.items)
        setSavedNextCursor(result.data.nextCursor)
        setSavedReferences(Object.fromEntries(
          result.data.items.map((saved) => [saved.item.id, saved.id]),
        ))
        setSavedStatus('ready')
      })
      .catch((error: unknown) => {
        if (
          sequence !== savedRequestSequence.current
          || (error instanceof ApiClientError && error.code === 'REQUEST_ABORTED')
        ) return
        setSavedError(errorMessage(error))
        setSavedStatus('error')
      })

    return () => controller.abort()
  }, [savedReloadKey, sessionStatus, view])

  const loadMore = useCallback(async () => {
    if (nextCursor === null || isLoadingMore) return
    const sequence = requestSequence.current
    setIsLoadingMore(true)
    setLoadMoreError(null)
    try {
      const result = await getDiscoverPage({
        category,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      })
      if (sequence !== requestSequence.current) return
      setItems((current) => mergeItems(current, result.data.items))
      setSources(result.data.sources)
      setNextCursor(result.data.nextCursor)
      setSavedReferences((current) => ({
        ...current,
        ...Object.fromEntries(
          result.data.savedItems.map((item) => [item.itemId, item.savedItemId]),
        ),
      }))
    } catch (error) {
      if (sequence === requestSequence.current) setLoadMoreError(errorMessage(error))
    } finally {
      if (sequence === requestSequence.current) setIsLoadingMore(false)
    }
  }, [category, isLoadingMore, nextCursor])

  const loadMoreSaved = useCallback(async () => {
    if (savedNextCursor === null || isLoadingMoreSaved) return
    const sequence = savedRequestSequence.current
    setIsLoadingMoreSaved(true)
    setSavedLoadMoreError(null)
    try {
      const result = await getSavedDiscoverItems({
        cursor: savedNextCursor,
        limit: PAGE_SIZE,
      })
      if (sequence !== savedRequestSequence.current) return
      setSavedItems((current) => mergeSavedItems(current, result.data.items))
      setSavedReferences((current) => ({
        ...current,
        ...Object.fromEntries(
          result.data.items.map((saved) => [saved.item.id, saved.id]),
        ),
      }))
      setSavedNextCursor(result.data.nextCursor)
    } catch (error) {
      if (sequence === savedRequestSequence.current) setSavedLoadMoreError(errorMessage(error))
    } finally {
      if (sequence === savedRequestSequence.current) setIsLoadingMoreSaved(false)
    }
  }, [isLoadingMoreSaved, savedNextCursor])

  const toggleSaved = useCallback(async (item: DiscoverItem) => {
    if (savingItemIds.has(item.id)) return
    const savedItemId = savedReferences[item.id]
    setSavingItemIds((current) => new Set(current).add(item.id))
    setMutationError(null)
    try {
      if (savedItemId) {
        await deleteSavedDiscoverItem(savedItemId)
        setSavedReferences((current) => {
          const next = { ...current }
          delete next[item.id]
          return next
        })
        setSavedItems((current) => current.filter((saved) => saved.id !== savedItemId))
      } else {
        const result = await saveDiscoverItem(item.id)
        const saved = result.data.savedItem
        setSavedReferences((current) => ({ ...current, [item.id]: saved.id }))
        setSavedItems((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)])
      }
    } catch (error) {
      setMutationError(errorMessage(error))
    } finally {
      setSavingItemIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }, [savedReferences, savingItemIds])

  const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources])
  const allSourcesUnavailable = enabledSources.length > 0
    && enabledSources.every((source) => source.status === 'UNAVAILABLE')
  const activeTab = TABS.find((tab) => tab.category === category) ?? TABS[0]

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? TABS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length
    const nextTab = TABS[nextIndex]
    if (!nextTab) return
    setCategory(nextTab.category)
    window.requestAnimationFrame(() => {
      document.getElementById(`discover-tab-${nextTab.category.toLowerCase()}`)?.focus()
    })
  }

  return (
    <div className="space-y-8 sm:space-y-10">
      <PageHeader
        eyebrow="Discover"
        title="다음 개발 기회를 발견하세요."
        description="외부 채용·개발 소식·커뮤니티를 한곳에서 살펴보고, 원문에서 최신 조건을 확인하세요."
        action={(
          <div className="flex rounded-xl border border-slate-800 bg-slate-900 p-1" aria-label="Discover 보기">
            <button
              type="button"
              aria-pressed={view === 'EXPLORE'}
              onClick={() => setView('EXPLORE')}
              className={`rounded-lg px-3 py-2 text-sm font-bold ${view === 'EXPLORE' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
            >
              탐색
            </button>
            <button
              type="button"
              aria-pressed={view === 'SAVED'}
              onClick={() => setView('SAVED')}
              className={`rounded-lg px-3 py-2 text-sm font-bold ${view === 'SAVED' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
            >
              저장한 항목
            </button>
          </div>
        )}
      />

      {view === 'EXPLORE' ? <div
        className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-800 bg-slate-900 p-1.5"
        role="tablist"
        aria-label="Discover 카테고리"
      >
        {TABS.map((tab, index) => {
          const Icon = tab.icon
          const selected = category === tab.category
          return (
            <button
              key={tab.category}
              id={`discover-tab-${tab.category.toLowerCase()}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="discover-tab-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setCategory(tab.category)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-bold transition sm:px-4 ${
                selected
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              <Icon className="hidden sm:block" size={17} aria-hidden="true" />
              <span className="whitespace-nowrap text-xs sm:text-sm">{tab.label}</span>
            </button>
          )
        })}
      </div> : null}

      <section
        id="discover-tab-panel"
        role={view === 'EXPLORE' ? 'tabpanel' : undefined}
        aria-labelledby={view === 'EXPLORE' ? `discover-tab-${category.toLowerCase()}` : undefined}
        className="space-y-6"
      >
        <div>
          <h2 className="text-xl font-bold text-white">{view === 'SAVED' ? '저장한 항목' : activeTab.label}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {view === 'SAVED' ? '나중에 다시 볼 기회를 source 상태와 관계없이 확인하세요.' : activeTab.description}
          </p>
        </div>

        {mutationError ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-100/80" role="alert">
            저장 상태를 변경하지 못했습니다. {mutationError}
          </div>
        ) : null}

        {sessionStatus === 'loading' ? (
          <div className="grid min-h-56 place-items-center rounded-2xl border border-slate-800 bg-slate-900/40" role="status">
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> 로그인 상태 확인 중
            </p>
          </div>
        ) : sessionStatus === 'unauthenticated' ? (
          <div className="grid min-h-56 place-items-center rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center">
            <p className="text-sm leading-6 text-slate-400">GitHub 로그인 후 Discover를 이용할 수 있습니다.</p>
          </div>
        ) : sessionStatus === 'error' ? (
          <div className="grid min-h-56 place-items-center rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center">
            <p className="text-sm leading-6 text-slate-400">세션 연결을 복구하면 Discover 항목을 불러옵니다.</p>
          </div>
        ) : view === 'SAVED' ? (
          savedStatus === 'loading' || savedStatus === 'idle' ? (
            <div className="grid min-h-56 place-items-center rounded-2xl border border-slate-800 bg-slate-900/40" role="status">
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> 저장한 항목을 불러오는 중
              </p>
            </div>
          ) : savedStatus === 'error' ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/5 p-6 text-center" role="alert">
              <AlertTriangle className="text-rose-300" size={28} aria-hidden="true" />
              <p className="mt-4 font-bold text-rose-100">저장한 항목을 불러오지 못했습니다.</p>
              <p className="mt-2 text-sm leading-6 text-rose-100/70">{savedError}</p>
              <button
                type="button"
                onClick={() => setSavedReloadKey((current) => current + 1)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-rose-300/30 px-4 py-2.5 text-sm font-bold text-rose-100 hover:bg-rose-300/10"
              >
                <RefreshCw size={16} aria-hidden="true" /> 다시 시도
              </button>
            </div>
          ) : (
            <>
              {savedItems.length === 0 ? (
                <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
                  <div>
                    <Bookmark className="mx-auto text-slate-500" size={30} aria-hidden="true" />
                    <p className="mt-4 font-bold text-slate-300">저장한 항목이 없습니다.</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">탐색에서 다시 보고 싶은 항목을 저장해 보세요.</p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2" aria-live="polite">
                  {savedItems.map((saved) => (
                    <DiscoverCard
                      key={saved.id}
                      item={saved.item}
                      savedItemId={saved.id}
                      isSaving={savingItemIds.has(saved.item.id)}
                      onToggleSaved={() => void toggleSaved(saved.item)}
                    />
                  ))}
                </div>
              )}

              {savedLoadMoreError ? (
                <div className="flex flex-col gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
                  <p className="text-sm text-rose-100/80">{savedLoadMoreError}</p>
                  <button type="button" onClick={() => void loadMoreSaved()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300/30 px-3 py-2 text-sm font-bold text-rose-100">
                    <RefreshCw size={15} aria-hidden="true" /> 더 보기 재시도
                  </button>
                </div>
              ) : null}

              {savedNextCursor !== null && savedLoadMoreError === null ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={isLoadingMoreSaved}
                    onClick={() => void loadMoreSaved()}
                    className="inline-flex min-w-36 items-center justify-center gap-2 rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-200 transition hover:border-emerald-300/50 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isLoadingMoreSaved ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : null}
                    {isLoadingMoreSaved ? '불러오는 중' : '더 보기'}
                  </button>
                </div>
              ) : null}
            </>
          )
        ) : pageStatus === 'loading' || pageStatus === 'idle' ? (
          <div className="grid min-h-56 place-items-center rounded-2xl border border-slate-800 bg-slate-900/40" role="status">
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <LoaderCircle className="animate-spin" size={18} aria-hidden="true" /> 항목을 불러오는 중
            </p>
          </div>
        ) : pageStatus === 'error' ? (
          <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/5 p-6 text-center" role="alert">
            <AlertTriangle className="text-rose-300" size={28} aria-hidden="true" />
            <p className="mt-4 font-bold text-rose-100">Discover를 불러오지 못했습니다.</p>
            <p className="mt-2 text-sm leading-6 text-rose-100/70">{pageError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((current) => current + 1)}
              className="mt-5 inline-flex items-center gap-2 rounded-xl border border-rose-300/30 px-4 py-2.5 text-sm font-bold text-rose-100 hover:bg-rose-300/10"
            >
              <RefreshCw size={16} aria-hidden="true" /> 다시 시도
            </button>
          </div>
        ) : (
          <>
            <SourceStatusList sources={sources} />
            <SourceNotice
              sources={sources}
              onRetry={() => setReloadKey((current) => current + 1)}
            />

            {items.length === 0 && !allSourcesUnavailable ? (
              <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
                <div>
                  <SearchX className="mx-auto text-slate-500" size={30} aria-hidden="true" />
                  <p className="mt-4 font-bold text-slate-300">현재 표시할 항목이 없습니다.</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">새 항목이 확인되면 이 탭에 표시됩니다.</p>
                </div>
              </div>
            ) : items.length > 0 ? (
              <div className="grid gap-4 lg:grid-cols-2" aria-live="polite">
                {items.map((item) => (
                  <DiscoverCard
                    key={item.id}
                    item={item}
                    savedItemId={savedReferences[item.id] ?? null}
                    isSaving={savingItemIds.has(item.id)}
                    onToggleSaved={() => void toggleSaved(item)}
                  />
                ))}
              </div>
            ) : null}

            {loadMoreError ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
                <p className="text-sm text-rose-100/80">{loadMoreError}</p>
                <button type="button" onClick={() => void loadMore()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300/30 px-3 py-2 text-sm font-bold text-rose-100">
                  <RefreshCw size={15} aria-hidden="true" /> 더 보기 재시도
                </button>
              </div>
            ) : null}

            {nextCursor !== null && loadMoreError === null ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => void loadMore()}
                  className="inline-flex min-w-36 items-center justify-center gap-2 rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-200 transition hover:border-emerald-300/50 disabled:cursor-wait disabled:opacity-60"
                >
                  {isLoadingMore ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : null}
                  {isLoadingMore ? '불러오는 중' : '더 보기'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <aside className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-sm leading-6 text-slate-500">
        AISideQuest는 외부 정보를 연결하며 채용, 수익, 보상 지급 또는 항목의 현재 상태를 보장하지 않습니다.
        지원하거나 참여하기 전에 원문 조건을 확인해 주세요. Discover 조회와 원문 이동에는 AISideQuest 포인트가 지급되지 않습니다.
      </aside>
    </div>
  )
}

export default DiscoverPage
