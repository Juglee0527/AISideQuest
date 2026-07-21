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
  return null
}

describe('Discover page', () => {
  it('loads category tabs and opens only the validated external original link', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
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
            originalUrl: 'https://news.ycombinator.com/item?id=202',
            attribution: 'Hacker News',
          })],
          nextCursor: null,
          savedItems: [],
          sources: [source('HACKER_NEWS', 'Hacker News', ['EARNING', 'NEWS', 'COMMUNITY'])],
        })
      }

      return response({
        items: [item()],
        nextCursor: null,
        savedItems: [],
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

    fireEvent.click(screen.getByRole('tab', { name: '개발 소식' }))
    expect(await screen.findByText('A new TypeScript release')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '개발 소식' })).toHaveAttribute('aria-selected', 'true')
    expect(fetchMock.mock.calls.some(([input]) => (
      new URL(String(input)).searchParams.get('category') === 'NEWS'
    ))).toBe(true)
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
          sources: [source('REMOTIVE', 'Remotive', ['EARNING'], 'UNAVAILABLE')],
        })
      }
      if (discoverRequest === 2) {
        return response({
          items: [item()],
          nextCursor: 'next-page',
          savedItems: [],
          sources: [source('REMOTIVE', 'Remotive', ['EARNING'])],
        })
      }
      if (discoverRequest === 3) throw new TypeError('network down')
      return response({
        items: [item({ id: 'REMOTIVE:102', title: 'Backend Contract Engineer' })],
        nextCursor: null,
        savedItems: [],
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

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
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
})
