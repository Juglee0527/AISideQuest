import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import LegacyDataMigrationGate from './LegacyDataMigrationGate'
import {
  loadLegacyReferenceSummary,
  saveLegacySessionState,
} from '../storage/appStorage'

describe('LegacyDataMigrationGate', () => {
  it('blocks the app until valid legacy data is handled once', () => {
    expect(saveLegacySessionState({
      activeSession: null,
      completedSessions: [
        {
          id: 'legacy-session',
          startedAt: '2026-07-15T00:00:00.000Z',
          endedAt: '2026-07-15T00:02:00.000Z',
          duration: 120_000,
        },
      ],
    })).toBe(true)

    render(
      <LegacyDataMigrationGate>
        <p>서버 앱</p>
      </LegacyDataMigrationGate>,
    )

    expect(screen.queryByText('서버 앱')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '기존 MVP 기록을 처리해 주세요.' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '참고 요약으로 보관' }))

    expect(screen.getByText('서버 앱')).toBeInTheDocument()
    expect(loadLegacyReferenceSummary()).toMatchObject({
      completedSessionCount: 1,
      totalDurationMs: 120_000,
    })
  })

  it('only offers reset when the legacy value is corrupted', () => {
    window.localStorage.setItem('aisidequest.sessions', '{broken')

    render(
      <LegacyDataMigrationGate>
        <p>서버 앱</p>
      </LegacyDataMigrationGate>,
    )

    expect(screen.getByRole('button', { name: '참고 요약으로 보관' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '기존 기록 초기화' }))
    expect(screen.getByText('서버 앱')).toBeInTheDocument()
  })
})
