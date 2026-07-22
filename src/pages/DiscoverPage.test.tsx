import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SessionProvider } from '../contexts/SessionContext'
import type {
  DiscoverCategory,
  DiscoverItem,
  DiscoverSourceSnapshot,
} from '../types/discover'
import DiscoverPage from './DiscoverPage'

const SERVER_TIME = '2026-07-21T08:00:00.000Z'

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({
    ...(status >= 400 ? { error: data } : { data }),
    meta: { serverTime: SERVER_TIME },
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function source(
  sourceId: DiscoverSourceSnapshot['source'],
  displayName: string,
  categories: DiscoverCategory[],
  status: DiscoverSourceSnapshot['status'] = 'FRESH',
  enabled = true,
): DiscoverSourceSnapshot {
  return {
    source: sourceId,
    displayName,
    categories,
    enabled,
    status,
    fetchedAt: status === 'UNAVAILABLE' ? null : SERVER_TIME,
  }
}

function item(overrides: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    id: 'REMOTIVE:101',
    source: 'REMOTIVE',
    category: 'EARNING',
    kind: 'PAID_JOB',
    title: 'Remote TypeScript Engineer',
    summary: 'Example · Worldwide — Build reliable software.',
    tags: ['remote', 'full-time'],
    reward: null,
    compensation: { provided: true, text: '$100k-$120k yearly' },
    engagement: null,
    readingTimeMinutes: null,
    originalUrl: 'https://remotive.com/remote-jobs/software-dev/example',
    attribution: 'Remotive',
    publishedAt: '2026-07-20T08:00:00.000Z',
    fetchedAt: SERVER_TIME,
    ...overrides,
  }
}

function renderDiscover(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <SessionProvider>
      <DiscoverPage />
    </SessionProvider>,
  )
}

function sessionResponse(url: URL) {
  if (url.pathname.endsWith('/sessions/active')) return response([])
  if (url.pathname.endsWith('/sessions')) {
    return response({ items: [], nextCursor: null })
  }
  if (url.pathname.endsWith('/discover/interests')) {
    return response({ tags: [], updatedAt: null })
  }
  if (url.pathname.endsWith('/discover/events')) {
    return response({ recorded: true })
  }
  return null
}

describe('Discover page', () => {
  it('loads category tabs and opens only the validated external original link', async () => {
    document.cookie = 'aisidequest_csrf=analytics-csrf; path=/'
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input))
      const session = sessionResponse(url)
      if (session) return session

      const category = url.searchParams.get('category')
      if (category === 'NEWS') {
        return response({
          items: [item({
            id: 'HACKER_NEWS:202',
            source: 'HACKER_NEWS',
            category: 'NEWS',
            kind: 'ARTICLE',
            title: 'A new TypeScript release',
            compensation: null,
            readingTimeMinutes: 5,
            originalUrl: 'https://news.ycombinator.com/item?id=202',
            attribution: 'Hacker News',
          })],
          nextCursor: null,
          savedItems: [],
          recommendations: [],
          sources: [source('HACKER_NEWS', 'Hacker News', ['EARNING', 'NEWS', 'COMMUNITY'])],
        })
      }

      return response({
        items: [item()],
        nextCursor: null,
        savedItems: [],
        recommendations: [],
        sources: [
          source('HACKER_NEWS', 'Hacker News', ['EARNING', 'NEWS', 'COMMUNITY']),
          source('REMOTIVE', 'Remotive', ['EARNING']),
        ],
      })
    })

    renderDiscover(fetchMock)

    expect(await screen.findByText('Remote TypeScript Engineer')).toBeInTheDocument()
    expect(screen.getByText('출처 제공 급여 · $100k-$120k yearly')).toBeInTheDocument()
    expect(screen.getByText(/Remotive · 최신/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '수익 기회' })).toHaveAttribute('aria-selected', 'true')
    const originalLink = screen.getByRole('link', {
      name: 'Remote TypeScript Engineer 원문 보기 (Remotive)',
    })
    expect(originalLink).toHaveAttribute('target', '_blank')
    expect(originalLink).toHaveAttribute('rel', 'noopener noreferrer')
    const analyticsBodies = () => fetchMock.mock.calls
      .filter(([input]) => new URL(String(input)).pathname.endsWith('/discover/events'))
      .map(([, init]) => JSON.parse(String(init?.body))) as Array<{ eventName: string; category?: string }>
    expect(analyticsBodies().some((body) => body.eventName === 'TAB_VIEW')).toBe(false)

    fireEvent.click(screen.getByRole('tab', { name: '개발 소식' }))
    expect(await screen.findByText('A new TypeScript release')).toBeInTheDocument()
    expect(screen.getByText('· 5분 읽기')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '개발 소식' })).toHaveAttribute('aria-selected', 'true')
    expect(fetchMock.mock.calls.some(([input]) => (
      new URL(String(input)).searchParams.get('category') === 'NEWS'
    ))).toBe(true)
    await waitFor(() => expect(analyticsBodies().filter((body) => (
      body.eventName === 'TAB_VIEW' && body.category === 'NEWS'
    ))).toHaveLength(1))
  })

  it('labels Stack Overflow bounties as reputation instead of cash or points', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const session = sessionResponse(url)
      if (session) return session

      if (url.searchParams.get('category') === 'COMMUNITY') {
        return response({
          items: [item({
            id: 'STACK_EXCHANGE:404',
            source: 'STACK_EXCHANGE',
            category: 'COMMUNITY',
            kind: 'REPUTATION_BOUNTY',
            title: 'How should this TypeScript type be modeled?',
            compensation: null,
            reward: { type: 'REPUTATION_BOUNTY', amount: 100 },
            originalUrl: 'https://stackoverflow.com/questions/404/example',
            attribution: 'Stack Overflow',
          })],
          nextCursor: null,
          savedItems: [],
          recommendations: [],
          sources: [source('STACK_EXCHANGE', 'Stack Overflow', ['COMMUNITY'])],
        })
      }

      return response({
        items: [],
        nextCursor: null,
        savedItems: [],
        recommendations: [],
        sources: [source('STACK_EXCHANGE', 'Stack Overflow', ['COMMUNITY'])],
      })
    })

    renderDiscover(fetchMock)
    fireEvent.click(screen.getByRole('tab', { name: '커뮤니티' }))

    expect(await screen.findByText('How should this TypeScript type be modeled?')).toBeInTheDocument()
    expect(screen.getByText('평판 보상 100')).toBeInTheDocument()
    expect(screen.queryByText(/검증된 바운티/)).not.toBeInTheDocument()
  })

  it('keeps available items visible when one enabled source is unavailable', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const session = sessionResponse(url)
      if (session) return session
      return response({
        items: [item({
          id: 'HACKER_NEWS:303',
          source: 'HACKER_NEWS',
          title: 'Who is hiring?',
          compensation: { provided: false, text: null },
          originalUrl: 'https://news.ycombinator.com/item?id=303',
          attribution: 'Hacker News',
        })],
        nextCursor: null,
        savedItems: [],
        recommendations: [],
        sources: [
          source('HACKER_NEWS', 'Hacker News', ['EARNING', 'NEWS', 'COMMUNITY'], 'STALE'),
          source('REMOTIVE', 'Remotive', ['EARNING'], 'UNAVAILABLE'),
        ],
      })
    })

    renderDiscover(fetchMock)

    expect(await screen.findByText('Who is hiring?')).toBeInTheDocument()
    expect(screen.getByText(/Hacker News · 마지막 확인 정보/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Hacker News는 마지막으로 확인된 정보를 표시하고 있습니다.')
    expect(screen.getByRole('status')).toHaveTextContent('Remotive 항목은 현재 제외되었습니다.')
    expect(screen.getByText('급여 정보 미제공')).toBeInTheDocument()
  })

  it('distinguishes a healthy empty result from a total source failure', async () => {
    let unavailable = false
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const session = sessionResponse(url)
      if (session) return session
      return response({
        items: [],
        nextCursor: null,
        savedItems: [],
        recommendations: [],
        sources: [
          source(
            'HACKER_NEWS',
            'Hacker News',
            ['EARNING', 'NEWS', 'COMMUNITY'],
            unavailable ? 'UNAVAILABLE' : 'FRESH',
          ),
          source(
            'REMOTIVE',
            'Remotive',
            ['EARNING'],
            unavailable ? 'UNAVAILABLE' : 'FRESH',
          ),
        ],
      })
    })

    const view = renderDiscover(fetchMock)
    expect(await screen.findByText('현재 표시할 항목이 없습니다.')).toBeInTheDocument()

    view.unmount()
    unavailable = true
    renderDiscover(fetchMock)
    expect(await screen.findByRole('alert')).toHaveTextContent('현재 이 탭의 정보를 불러올 수 없습니다.')
    expect(screen.queryByText('현재 표시할 항목이 없습니다.')).not.toBeInTheDocument()
  })

  it('shows a retryable initial request error', async () => {
    let discoverRequest = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const session = sessionResponse(url)
      if (session) return session
      discoverRequest += 1
      if (discoverRequest === 1) throw new TypeError('network down')
      return response({
        items: [],
        nextCursor: null,
        savedItems: [],
        recommendations: [],
        sources: [source('REMOTIVE', 'Remotive', ['EARNING'])],
      })
    })

    renderDiscover(fetchMock)
    expect(await screen.findByRole('alert')).toHaveTextContent('Discover를 불러오지 못했습니다.')
    expect(screen.getByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다.')

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('현재 표시할 항목이 없습니다.')).toBeInTheDocument()
  })

  it('retries total source unavailability and preserves paging items on a later-page error', async () => {
    let discoverRequest = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const session = sessionResponse(url)
      if (session) return session
      discoverRequest += 1

      if (discoverRequest === 1) {
        return response({
          items: [],
          nextCursor: null,
          savedItems: [],
          recommendations: [],
          sources: [source('REMOTIVE', 'Remotive', ['EARNING'], 'UNAVAILABLE')],
        })
      }
      if (discoverRequest === 2) {
        return response({
          items: [item()],
          nextCursor: 'next-page',
          savedItems: [],
          recommendations: [],
          sources: [source('REMOTIVE', 'Remotive', ['EARNING'])],
        })
      }
      if (discoverRequest === 3) throw new TypeError('network down')
      return response({
        items: [item({ id: 'REMOTIVE:102', title: 'Backend Contract Engineer' })],
        nextCursor: null,
        savedItems: [],
        recommendations: [],
        sources: [source('REMOTIVE', 'Remotive', ['EARNING'])],
      })
    })

    renderDiscover(fetchMock)
    expect(await screen.findByRole('alert')).toHaveTextContent('현재 이 탭의 정보를 불러올 수 없습니다.')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('Remote TypeScript Engineer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다.')
    expect(screen.getByText('Remote TypeScript Engineer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '더 보기 재시도' }))
    expect(await screen.findByText('Backend Contract Engineer')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument())
  })

  it('saves an item, reads its snapshot independently, and removes it safely', async () => {
    document.cookie = 'aisidequest_csrf=test-csrf; path=/'
    const savedItemId = '00000000-0000-4000-8000-000000000027'
    let saved = false
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const session = sessionResponse(url)
      if (session) return session

      if (url.pathname.endsWith('/discover/saved-items') && init?.method === 'POST') {
        saved = true
        return response({
          created: true,
          savedItem: { id: savedItemId, item: item(), savedAt: SERVER_TIME },
        })
      }
      if (url.pathname.endsWith(`/discover/saved-items/${savedItemId}`)) {
        saved = false
        return response({ deleted: true, savedItemId })
      }
      if (url.pathname.endsWith('/discover/saved-items')) {
        return response({
          items: saved ? [{ id: savedItemId, item: item(), savedAt: SERVER_TIME }] : [],
          nextCursor: null,
        })
      }
      return response({
        items: [item()],
        nextCursor: null,
        savedItems: [],
        recommendations: [],
        sources: [source('REMOTIVE', 'Remotive', ['EARNING'])],
      })
    })

    renderDiscover(fetchMock)
    const saveButton = await screen.findByRole('button', {
      name: 'Remote TypeScript Engineer 저장',
    })
    fireEvent.click(saveButton)
    expect(await screen.findByRole('button', {
      name: 'Remote TypeScript Engineer 저장 취소',
    })).toBeInTheDocument()

    const saveCall = fetchMock.mock.calls.find(([input, init]) => (
      init?.method === 'POST'
      && new URL(String(input)).pathname.endsWith('/discover/saved-items')
    ))
    expect(saveCall?.[1]?.headers).toMatchObject({
      'x-csrf-token': 'test-csrf',
      'Content-Type': 'application/json',
    })
    expect(saveCall?.[1]?.headers).toHaveProperty('Idempotency-Key')

    fireEvent.click(screen.getByRole('button', { name: '저장한 항목' }))
    expect(await screen.findByText('나중에 다시 볼 기회를 source 상태와 관계없이 확인하세요.')).toBeInTheDocument()
    expect(screen.getByText('Remote TypeScript Engineer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'Remote TypeScript Engineer 저장 취소',
    }))
    expect(await screen.findByText('저장한 항목이 없습니다.')).toBeInTheDocument()
  })

  it('uses only explicitly saved interests and shows deterministic recommendation reasons', async () => {
    document.cookie = 'aisidequest_csrf=interest-csrf; path=/'
    let personalized = false
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/discover/interests') && init?.method === 'PUT') {
        personalized = true
        return response({ tags: ['typescript'], updatedAt: SERVER_TIME })
      }
      const session = sessionResponse(url)
      if (session) return session

      return response({
        items: [item({ tags: ['typescript', 'remote'] })],
        nextCursor: null,
        savedItems: [],
        recommendations: personalized ? [{
          itemId: 'REMOTIVE:101',
          reasons: ['INTEREST_MATCH', 'RECENT', 'CLEAR_VALUE'],
          matchedInterests: ['typescript'],
        }] : [],
        sources: [source('REMOTIVE', 'Remotive', ['EARNING'])],
      })
    })

    renderDiscover(fetchMock)
    expect(await screen.findByText('Remote TypeScript Engineer')).toBeInTheDocument()
    fireEvent.click(screen.getByText('관심 기술 설정'))
    expect(screen.getByText(/프롬프트, 코드, 경로와 작업 내용은 사용하지 않습니다/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'TypeScript' }))
    fireEvent.click(screen.getByRole('button', { name: '관심 기술 저장' }))

    expect(await screen.findByText('추천 이유')).toBeInTheDocument()
    expect(screen.getByText('관심 기술 일치 · TypeScript')).toBeInTheDocument()
    expect(screen.getByText('최신 항목')).toBeInTheDocument()
    expect(screen.getByText('보상·급여 정보 명확')).toBeInTheDocument()

    const updateCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(updateCall?.[1]).toMatchObject({ body: JSON.stringify({ tags: ['typescript'] }) })
    expect(updateCall?.[1]?.headers).toMatchObject({
      'x-csrf-token': 'interest-csrf',
      'Content-Type': 'application/json',
    })
    expect(updateCall?.[1]?.headers).toHaveProperty('Idempotency-Key')
  })
})
