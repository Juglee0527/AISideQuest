import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { QuestCatalogProvider } from './contexts/QuestCatalogContext'
import { QuestHistoryProvider } from './contexts/QuestHistoryContext'
import { SessionProvider } from './contexts/SessionContext'
import type { Session, SessionStatus } from './types/session'

const questFixture = {
  id: '00000000-0000-4000-8000-000000000020',
  code: 'ai-workflow-survey',
  version: 1,
  title: 'AI 작업 경험 설문',
  description: 'AI 도구 사용 경험을 돌아보는 간단한 설문입니다.',
  estimatedMinutes: 3,
  rewardPoints: 100,
  passScore: 100,
  retryAllowed: true,
  completionStatus: 'NOT_STARTED',
  latestAttempt: null,
}

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SessionProvider>
        <QuestCatalogProvider>
          <QuestHistoryProvider>
            <App />
          </QuestHistoryProvider>
        </QuestCatalogProvider>
      </SessionProvider>
    </MemoryRouter>,
  )
}

function createSession(
  id: string,
  status: SessionStatus,
  startedAt: string,
  endedAt: string | null = null,
): Session {
  const currentTime = Date.now()

  return {
    id,
    provider: 'CODEX',
    status,
    origin: 'MANUAL',
    autoLinked: false,
    startedAt,
    endedAt,
    lastActivityAt: endedAt ?? new Date(currentTime).toISOString(),
    durationMs: Math.max(
      0,
      (endedAt === null ? currentTime : Date.parse(endedAt)) - Date.parse(startedAt),
    ),
    terminalReason: status === 'COMPLETED' ? 'MANUAL_COMPLETED' : null,
    timingQuality: 'EXACT',
    version: status === 'COMPLETED' ? 2 : 1,
  }
}

function jsonResponse(
  data: unknown,
  status = 200,
  responseServerTime = new Date().toISOString(),
) {
  return new Response(
    JSON.stringify({
      ...(status >= 400 ? { error: data } : { data }),
      meta: { serverTime: responseServerTime },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

async function flushRequests() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) {
      await Promise.resolve()
    }
  })
}

describe('AISideQuest API session flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T00:00:00.000Z'))
    document.cookie = 'aisidequest_csrf=test-csrf; path=/'
  })

  it('starts, polls, restores and ends the same server session without Session LocalStorage', async () => {
    let activeSession: Session | null = null
    let completedSessions: Session[] = []

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())

      if (url.pathname.endsWith('/sessions/active')) {
        return jsonResponse(activeSession === null
          ? null
          : createSession(activeSession.id, activeSession.status, activeSession.startedAt))
      }

      if (url.pathname.endsWith('/sessions') && init?.method !== 'POST') {
        return jsonResponse({
          items: [
            ...(activeSession === null ? [] : [activeSession]),
            ...completedSessions,
          ],
          nextCursor: null,
        })
      }

      if (url.pathname.endsWith('/quests')) {
        return jsonResponse({ items: [questFixture], nextCursor: null })
      }

      if (url.pathname.endsWith('/sessions/manual') && init?.method === 'POST') {
        activeSession ??= createSession(
          '00000000-0000-4000-8000-000000000001',
          'RUNNING',
          new Date().toISOString(),
        )
        return jsonResponse({ created: true, session: activeSession })
      }

      if (url.pathname.endsWith('/end') && init?.method === 'POST' && activeSession !== null) {
        const completedSession = createSession(
          activeSession.id,
          'COMPLETED',
          activeSession.startedAt,
          new Date().toISOString(),
        )
        completedSessions = [completedSession, ...completedSessions]
        activeSession = null
        return jsonResponse({ session: completedSession })
      }

      return jsonResponse({ code: 'NOT_FOUND', message: 'not found' }, 404)
    }))

    const firstRender = renderApp()
    await flushRequests()

    const startButton = screen.getByRole('button', { name: 'AI 작업 시작' })
    expect(startButton).toBeEnabled()

    fireEvent.click(startButton)
    await flushRequests()
    expect(screen.getByRole('button', { name: 'AI 작업 종료' })).toBeEnabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000)
    })
    expect(screen.getByRole('timer')).toHaveTextContent('01:05')

    activeSession = createSession(
      '00000000-0000-4000-8000-000000000001',
      'WAITING_FOR_USER',
      '2026-07-15T00:00:00.000Z',
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await flushRequests()
    expect(screen.getAllByText('Codex 확인 필요')).toHaveLength(2)

    fireEvent.click(screen.getByRole('link', { name: /사이드 퀘스트 둘러보기/ }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 작업 경험 설문 완료하기' }))
    expect(screen.getByText('현재 세션 1/1 완료')).toBeInTheDocument()

    firstRender.unmount()
    const secondRender = renderApp('/quests')
    await flushRequests()

    expect(screen.getByText('현재 세션 1/1 완료')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 작업 경험 설문 완료됨' })).toBeDisabled()
    fireEvent.click(screen.getByRole('link', { name: 'AISideQuest Home' }))
    expect(screen.getByRole('timer')).toHaveTextContent('01:10')

    secondRender.unmount()
    window.localStorage.clear()
    renderApp()
    await flushRequests()
    expect(screen.getByRole('timer')).toHaveTextContent('01:10')

    fireEvent.click(screen.getByRole('button', { name: 'AI 작업 종료' }))
    await flushRequests()

    expect(screen.getByRole('button', { name: 'AI 작업 시작' })).toBeEnabled()
    expect(screen.getByText('작업 대기 중')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('01:10')
    expect(window.localStorage.getItem('aisidequest.sessions')).toBeNull()
    expect(completedSessions).toHaveLength(1)
  })

  it('shows authentication expiry and the GitHub login route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      code: 'AUTH_REQUIRED',
      message: '로그인이 필요합니다.',
    }, 401)))

    renderApp()
    await flushRequests()

    expect(screen.getByRole('alert')).toHaveTextContent('로그인이 필요합니다.')
    expect(screen.getByRole('link', { name: 'GitHub로 로그인' })).toHaveAttribute(
      'href',
      'http://localhost:3000/api/v1/auth/github',
    )
    expect(screen.getByRole('button', { name: 'AI 작업 시작' })).toBeDisabled()
  })

  it('keeps an error state until retry reloads server data', async () => {
    let shouldFail = true

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (shouldFail) {
        throw new TypeError('network down')
      }

      const url = new URL(typeof input === 'string' ? input : input.toString())
      return url.pathname.endsWith('/sessions/active')
        ? jsonResponse(null)
        : jsonResponse({ items: [], nextCursor: null })
    }))

    renderApp()
    await flushRequests()

    expect(screen.getByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다.')
    shouldFail = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await flushRequests()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 작업 시작' })).toBeEnabled()
  })

  it('uses meta.serverTime instead of the browser clock for elapsed time', async () => {
    const activeSession = createSession(
      '00000000-0000-4000-8000-000000000001',
      'RUNNING',
      '2026-07-15T00:01:00.000Z',
    )
    const correctedServerTime = '2026-07-15T00:02:00.000Z'

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      return url.pathname.endsWith('/sessions/active')
        ? jsonResponse(activeSession, 200, correctedServerTime)
        : jsonResponse({ items: [activeSession], nextCursor: null }, 200, correctedServerTime)
    }))

    renderApp()
    await flushRequests()

    expect(screen.getByRole('timer')).toHaveTextContent('01:00')
  })

  it('polls connected devices and shows the latest automatic event', async () => {
    let hasReceivedEvent = false

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())

      if (url.pathname.endsWith('/sessions/active')) {
        return jsonResponse(null)
      }

      if (url.pathname.endsWith('/sessions')) {
        return jsonResponse({ items: [], nextCursor: null })
      }

      if (url.pathname.endsWith('/devices')) {
        return jsonResponse({
          items: [{
            id: '00000000-0000-4000-8000-000000000010',
            name: 'Windows Codex',
            pluginVersion: '0.1.0',
            lastSeenAt: hasReceivedEvent ? '2026-07-15T00:00:04.000Z' : null,
            expiresAt: '2026-10-15T00:00:00.000Z',
            revokedAt: null,
            createdAt: '2026-07-15T00:00:00.000Z',
          }],
        })
      }

      return jsonResponse({ code: 'NOT_FOUND', message: 'not found' }, 404)
    }))

    renderApp('/devices')
    await flushRequests()

    expect(screen.getByText('자동 감지 준비')).toBeInTheDocument()

    hasReceivedEvent = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await flushRequests()

    expect(screen.getByText('자동 감지 이벤트 수신')).toBeInTheDocument()
    expect(screen.getByText(/^마지막 이벤트 .*활성 기기 1개$/)).toBeInTheDocument()
  })

  it('shows quest loading failure and retries without a page reload', async () => {
    let questRequestFails = true

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/sessions/active')) return jsonResponse(null)
      if (url.pathname.endsWith('/sessions')) {
        return jsonResponse({ items: [], nextCursor: null })
      }
      if (url.pathname.endsWith('/quests')) {
        return questRequestFails
          ? jsonResponse({ code: 'QUESTS_UNAVAILABLE', message: '목록 조회 실패' }, 503)
          : jsonResponse({ items: [questFixture], nextCursor: null })
      }
      return jsonResponse({ code: 'NOT_FOUND', message: 'not found' }, 404)
    }))

    renderApp('/quests')
    await flushRequests()
    expect(screen.getByRole('alert')).toHaveTextContent('목록 조회 실패')

    questRequestFails = false
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await flushRequests()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(questFixture.title)).toBeInTheDocument()
  })

  it('keeps the previous quest list visible when a refresh fails', async () => {
    let questRequests = 0

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/sessions/active')) return jsonResponse(null)
      if (url.pathname.endsWith('/sessions')) {
        return jsonResponse({ items: [], nextCursor: null })
      }
      if (url.pathname.endsWith('/quests')) {
        questRequests += 1
        return questRequests === 1
          ? jsonResponse({ items: [questFixture], nextCursor: null })
          : jsonResponse({ code: 'QUESTS_UNAVAILABLE', message: '갱신 실패' }, 503)
      }
      return jsonResponse({ code: 'NOT_FOUND', message: 'not found' }, 404)
    }))

    renderApp('/quests')
    await flushRequests()
    expect(screen.getByText(questFixture.title)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '퀘스트 목록 새로고침' }))
    await flushRequests()
    expect(screen.getByRole('alert')).toHaveTextContent('갱신 실패')
    expect(screen.getByText(questFixture.title)).toBeInTheDocument()
  })

  it('shows an empty state when the server has no published quests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/sessions/active')) return jsonResponse(null)
      if (url.pathname.endsWith('/sessions')) {
        return jsonResponse({ items: [], nextCursor: null })
      }
      if (url.pathname.endsWith('/quests')) {
        return jsonResponse({ items: [], nextCursor: null })
      }
      return jsonResponse({ code: 'NOT_FOUND', message: 'not found' }, 404)
    }))

    renderApp('/quests')
    await flushRequests()
    expect(screen.getByText('현재 공개된 퀘스트가 없습니다.')).toBeInTheDocument()
  })
})
