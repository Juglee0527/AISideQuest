import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { QuestHistoryProvider } from './contexts/QuestHistoryContext'
import { SessionProvider } from './contexts/SessionContext'

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SessionProvider>
        <QuestHistoryProvider>
          <App />
        </QuestHistoryProvider>
      </SessionProvider>
    </MemoryRouter>,
  )
}

describe('AISideQuest main flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T00:00:00.000Z'))
  })

  it('starts a session, completes a quest, restores after reload, and ends the session', () => {
    const firstRender = renderApp()
    const startButton = screen.getByRole('button', { name: 'AI 작업 시작' })
    const endButton = screen.getByRole('button', { name: 'AI 작업 종료' })

    fireEvent.click(startButton)
    expect(startButton).toBeDisabled()
    expect(endButton).toBeEnabled()

    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByRole('timer')).toHaveTextContent('01:05')

    fireEvent.click(screen.getByRole('link', { name: /사이드 퀘스트 둘러보기/ }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 작업 경험 설문 완료하기' }))
    expect(screen.getByText('현재 세션 1/5 완료')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 작업 경험 설문 완료됨' })).toBeDisabled()

    firstRender.unmount()
    renderApp('/quests')

    expect(screen.getByText('현재 세션 1/5 완료')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 작업 경험 설문 완료됨' })).toBeDisabled()

    fireEvent.click(screen.getByRole('link', { name: 'AISideQuest Home' }))
    expect(screen.getByRole('timer')).toHaveTextContent('01:05')
    fireEvent.click(screen.getByRole('button', { name: 'AI 작업 종료' }))

    expect(screen.getByRole('button', { name: 'AI 작업 시작' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'AI 작업 종료' })).toBeDisabled()
    expect(screen.getByText('작업 대기 중')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('01:05')

    const storedSessions = JSON.parse(
      window.localStorage.getItem('aisidequest.sessions') ?? '{}',
    )
    expect(storedSessions.data.activeSession).toBeNull()
    expect(storedSessions.data.completedSessions).toHaveLength(1)
  })
})
