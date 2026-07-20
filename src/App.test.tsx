import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { QuestCatalogProvider } from './contexts/QuestCatalogContext'
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
          <App />
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
    expect(screen.getByRole('link', { name: 'AI 작업 경험 설문 퀴즈 시작' })).toBeInTheDocument()
    expect(screen.getByText('현재 세션 0/1 완료')).toBeInTheDocument()

    firstRender.unmount()
    const secondRender = renderApp('/quests')
    await flushRequests()

    expect(screen.getByText('현재 세션 0/1 완료')).toBeInTheDocument()
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

  it('approves a browser device connection without showing a connection code', async () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174050'
    let approved = false
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      _init?: RequestInit,
    ) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/sessions/active')) return jsonResponse(null)
      if (url.pathname.endsWith('/sessions')) {
        return jsonResponse({ items: [], nextCursor: null })
      }
      if (url.pathname.endsWith('/quests')) {
        return jsonResponse({ items: [], nextCursor: null })
      }
      if (url.pathname.endsWith(`/device-link-requests/${requestId}/approve`)) {
        approved = true
        return jsonResponse({
          request: {
            id: requestId,
            status: 'APPROVED',
            deviceName: 'Browser Codex',
            pluginVersion: '0.2.0',
            expiresAt: '2026-07-15T00:10:00.000Z',
            approvedAt: '2026-07-15T00:00:01.000Z',
            verificationUrl: `http://localhost:5173/devices/connect/${requestId}`,
          },
          device: {
            id: '123e4567-e89b-42d3-a456-426614174051',
            name: 'Browser Codex',
            pluginVersion: '0.2.0',
            lastSeenAt: null,
            expiresAt: '2026-10-15T00:00:00.000Z',
            revokedAt: null,
            createdAt: '2026-07-15T00:00:01.000Z',
          },
        })
      }
      if (url.pathname.endsWith(`/device-link-requests/${requestId}`)) {
        return jsonResponse({
          request: {
            id: requestId,
            status: approved ? 'APPROVED' : 'PENDING',
            deviceName: 'Browser Codex',
            pluginVersion: '0.2.0',
            expiresAt: '2026-07-15T00:10:00.000Z',
            approvedAt: approved ? '2026-07-15T00:00:01.000Z' : null,
            verificationUrl: `http://localhost:5173/devices/connect/${requestId}`,
          },
        })
      }
      return jsonResponse({ code: 'NOT_FOUND', message: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderApp(`/devices/connect/${requestId}`)
    await flushRequests()

    expect(screen.getByText('이 기기를 연결할까요?')).toBeInTheDocument()
    expect(screen.getByText('Browser Codex')).toBeInTheDocument()
    expect(screen.queryByText(/--code/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이 기기 연결 승인' }))
    await flushRequests()

    expect(screen.getByText('연결 승인 완료')).toBeInTheDocument()
    const approvalCall = fetchMock.mock.calls.find(([input]) => (
      new URL(typeof input === 'string' ? input : input.toString()).pathname
        .endsWith(`/device-link-requests/${requestId}/approve`)
    ))
    expect(approvalCall?.[1]?.body).toBeUndefined()
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

  it('starts, saves, restores and submits a server-graded quest attempt', async () => {
    const activeSession = createSession(
      '00000000-0000-4000-8000-000000000001',
      'RUNNING',
      '2026-07-15T00:00:00.000Z',
    )
    const attemptId = '00000000-0000-4000-8000-000000000030'
    const questionId = '00000000-0000-4000-8000-000000000031'
    const optionId = '00000000-0000-4000-8000-000000000032'
    let attemptStarted = false
    let selectedOptionId: string | null = null
    let submitted = false

    const attempt = () => ({
      id: attemptId,
      aiSessionId: activeSession.id,
      status: submitted ? 'COMPLETED' : 'IN_PROGRESS',
      startedAt: '2026-07-15T00:00:10.000Z',
      submittedAt: submitted ? '2026-07-15T00:00:20.000Z' : null,
      completedAt: submitted ? '2026-07-15T00:00:20.000Z' : null,
      submissionDeadline: null,
      canSubmit: !submitted,
      canRetry: false,
      quest: {
        id: questFixture.id,
        code: questFixture.code,
        version: 1,
        title: questFixture.title,
        passScore: 100,
        rewardPoints: 100,
        retryAllowed: true,
      },
      questions: [{
        id: questionId,
        position: 1,
        prompt: '서버에서만 채점되는 문제입니다.',
        selectedOptionId,
        options: [{ id: optionId, position: 1, label: '선택지 A' }],
      }],
      result: submitted
        ? { score: 100, passed: true, retryAllowed: true, answerReview: null }
        : null,
    })

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/sessions/active')) return jsonResponse(activeSession)
      if (url.pathname.endsWith('/sessions')) {
        return jsonResponse({ items: [activeSession], nextCursor: null })
      }
      if (url.pathname.endsWith(`/quests/${questFixture.code}/attempts`)) {
        attemptStarted = true
        return jsonResponse({ created: true, attempt: attempt() })
      }
      if (url.pathname.endsWith(`/quests/${questFixture.code}`)) {
        return jsonResponse({
          ...questFixture,
          completionStatus: submitted ? 'PASSED' : attemptStarted ? 'IN_PROGRESS' : 'NOT_STARTED',
          latestAttempt: attemptStarted ? {
            id: attemptId,
            status: submitted ? 'COMPLETED' : 'IN_PROGRESS',
            score: submitted ? 100 : null,
            passed: submitted ? true : null,
            startedAt: '2026-07-15T00:00:10.000Z',
            completedAt: submitted ? '2026-07-15T00:00:20.000Z' : null,
          } : null,
        })
      }
      if (url.pathname.endsWith(`/quest-attempts/${attemptId}/answers`)) {
        const payload = JSON.parse(String(init?.body)) as {
          answers: Array<{ selectedOptionId: string }>
        }
        selectedOptionId = payload.answers[0].selectedOptionId
        return jsonResponse(attempt())
      }
      if (url.pathname.endsWith(`/quest-attempts/${attemptId}/submissions`)) {
        submitted = true
        return jsonResponse({
          attempt: attempt(),
          pointAward: {
            ledgerEntryId: '00000000-0000-4000-8000-000000000040',
            points: 100,
          },
        })
      }
      if (url.pathname.endsWith(`/quest-attempts/${attemptId}`)) {
        return jsonResponse(attempt())
      }
      if (url.pathname.endsWith('/quests')) {
        return jsonResponse({ items: [{
          ...questFixture,
          completionStatus: submitted ? 'PASSED' : attemptStarted ? 'IN_PROGRESS' : 'NOT_STARTED',
          latestAttempt: attemptStarted ? {
            id: attemptId,
            status: submitted ? 'COMPLETED' : 'IN_PROGRESS',
            score: submitted ? 100 : null,
            passed: submitted ? true : null,
            startedAt: '2026-07-15T00:00:10.000Z',
            completedAt: submitted ? '2026-07-15T00:00:20.000Z' : null,
          } : null,
        }], nextCursor: null })
      }
      return jsonResponse({ code: 'NOT_FOUND', message: 'not found' }, 404)
    }))

    const firstRender = renderApp(`/quests/${questFixture.code}`)
    await flushRequests()
    fireEvent.click(screen.getByRole('button', { name: '퀴즈 시작' }))
    await flushRequests()
    fireEvent.click(screen.getByLabelText('선택지 A'))
    await flushRequests()
    expect(screen.getByText('모든 선택이 서버에 저장됨')).toBeInTheDocument()

    firstRender.unmount()
    renderApp(`/quest-attempts/${attemptId}`)
    await flushRequests()
    expect(screen.getByLabelText('선택지 A')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '답안 제출' }))
    fireEvent.click(screen.getByRole('button', { name: '최종 제출' }))
    await flushRequests()
    expect(screen.getByText('퀘스트를 통과했습니다!')).toBeInTheDocument()
    expect(screen.getByText('점수 100점 · 통과 기준 100점')).toBeInTheDocument()
  })
})
