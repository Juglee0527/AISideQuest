import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionProvider } from '../contexts/SessionContext'
import DashboardPage from './DashboardPage'

function response(data: unknown, status = 200, serverTime = '2026-07-18T06:00:00.000Z') {
  return new Response(JSON.stringify({
    ...(status >= 400 ? { error: data } : { data }),
    meta: { serverTime },
  }), { status, headers: { 'Content-Type': 'application/json' } })
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve()
  })
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <SessionProvider><DashboardPage /></SessionProvider>
    </MemoryRouter>,
  )
}

describe('Dashboard server statistics', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders server aggregates and reloads when the period changes', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/sessions/active')) return response(null)
      if (url.pathname.endsWith('/sessions')) return response({ items: [], nextCursor: null })
      if (url.pathname.endsWith('/stats/summary')) {
        const period = url.searchParams.get('period') ?? 'today'
        const asOf = '2026-07-18T06:00:00.000Z'
        return response({
          period,
          asOf,
          timeZone: { id: 'Asia/Seoul', verified: true },
          range: { startAt: '2026-07-17T15:00:00.000Z', endAt: '2026-07-18T15:00:00.000Z' },
          ai: { waitDurationMs: period === 'week' ? 7_200_000 : 3_600_000, sessionCount: 2, degradedSessionCount: 1 },
          quests: { completedCount: 2 },
          points: { earned: 200 },
        }, 200, asOf)
      }
      return response({ code: 'NOT_FOUND', message: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDashboard()
    await flush()
    expect(screen.getByText('1시간')).toBeInTheDocument()
    expect(screen.getByText('복구된 저품질 세션 1개 포함')).toBeInTheDocument()
    expect(screen.getAllByText('200P').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '이번 주' }))
    await flush()
    expect(screen.getByText('2시간')).toBeInTheDocument()
  })

  it('shows an explicit retry state for a failed statistics request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/sessions/active')) return response(null)
      if (url.pathname.endsWith('/sessions')) return response({ items: [], nextCursor: null })
      return response({ code: 'STATS_FAILED', message: '통계 실패' }, 500)
    }))
    renderDashboard()
    await flush()
    expect(screen.getByText('통계 실패')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})
