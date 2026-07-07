/**
 * ResultPage no-run-data recovery tests.
 *
 * When the result page is opened with no live run in memory (a direct link to
 * /bombsquad/result, a refresh that cleared the run context, or an odd
 * back-navigation), the `noRunData` branch used to render a broken-sounding
 * no-data message. It now renders an explicit restart surface keyed to the last
 * selected entry mode when available.
 *
 * These tests assert the default recovery actions, the completed daily handoff
 * direct-run path, and the practice-specific recovery copy. Setup mirrors the
 * other ResultPage tests but leaves sessionStorage without a game-state seed so
 * `GameProvider` hydrates to INITIAL_STATE (moduleStats: [], outcome: null),
 * which is exactly the `noRunData` case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('@/utils/device-fingerprint', () => ({
  getDeviceId: () => 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
}))
vi.mock('@shared/leaderboard-api', () => ({
  submitScore: vi.fn(),
}))
vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))
// Pin the survey as already answered so the post-game modal never opens — the
// recovery branch returns before the modal anyway, but this keeps the mock
// surface consistent with the sibling ResultPage tests.
vi.mock('@/utils/survey', () => ({
  hasAnsweredSurvey: () => true,
  markSurveyAnswered: vi.fn(),
}))
vi.mock('@/utils/nickname', () => ({
  NICKNAME_MAX_LENGTH: 20,
  getStoredNickname: () => '测试玩家',
  isValidNickname: () => true,
  setStoredNickname: () => true,
}))

import ResultPage from './ResultPage'
import { GameProvider } from '@/store/game-context'
import { saveEntryRecoveryState } from '@/utils/session'

// Renders the current pathname + search so navigation destinations can be
// asserted after a CTA click.
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderRecovery() {
  // No sessionStorage seed → GameProvider hydrates INITIAL_STATE → noRunData.
  return render(
    <MemoryRouter initialEntries={['/bombsquad/result']}>
      <Routes>
        <Route
          path="/bombsquad/result"
          element={
            <GameProvider>
              <ResultPage />
            </GameProvider>
          }
        />
        {/* Catch-all so the recovery CTAs have a destination to land on. */}
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ResultPage no-run-data recovery', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it('renders an explicit restart surface, not a scary no-data message', () => {
    renderRecovery()

    expect(screen.queryByText(/暂无数据/)).not.toBeInTheDocument()
    expect(screen.queryByText(/这一局没有数据/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '重新开始一局' })).toBeInTheDocument()
    expect(screen.getByText(/先把手册交给 AI/)).toBeInTheDocument()
  })

  it('shows the three recovery actions', () => {
    renderRecovery()

    expect(screen.getByRole('button', { name: /先交手册，再开始每日挑战/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '练习一局' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回主页' })).toBeInTheDocument()
  })

  it('the primary daily CTA navigates to the daily connect funnel', () => {
    renderRecovery()

    fireEvent.click(screen.getByRole('button', { name: /先交手册，再开始每日挑战/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('/bombsquad/connect?mode=daily')
  })

  it('「练习一局」navigates to the practice connect funnel', () => {
    renderRecovery()

    fireEvent.click(screen.getByRole('button', { name: '练习一局' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/bombsquad/connect?mode=practice')
  })

  it('「返回主页」navigates to the BombSquad landing page', () => {
    renderRecovery()

    fireEvent.click(screen.getByRole('button', { name: '返回主页' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/bombsquad')
  })

  // Guard against the recovery CTAs deep-linking straight into /bombsquad/run,
  // which would skip the connect/copy-manual handoff.
  it('the connect CTAs do not deep-link into /bombsquad/run', () => {
    renderRecovery()

    fireEvent.click(screen.getByRole('button', { name: /先交手册，再开始每日挑战/ }))

    expect(screen.getByTestId('location')).not.toHaveTextContent('/bombsquad/run')
  })

  it('daily recovery after manual handoff goes straight back to the daily run', () => {
    const manualUrl = 'https://claw.amio.fans/manual/2026-07-01'
    saveEntryRecoveryState({
      mode: 'daily',
      manualUrl,
      manualHandoffComplete: true,
      platformPartner: false,
    })
    renderRecovery()

    expect(screen.getByRole('heading', { name: '重新进入每日挑战' })).toBeInTheDocument()
    expect(screen.getByText(/手册对接已经完成/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /直接进入每日挑战/ }))

    expect(screen.getByTestId('location')).toHaveTextContent(
      `/bombsquad/run?mode=daily&url=${encodeURIComponent(manualUrl)}`
    )
  })

  it('practice recovery uses practice-specific copy and never points to daily challenge', () => {
    saveEntryRecoveryState({
      mode: 'practice',
      manualUrl: 'https://claw.amio.fans/manual/practice',
      manualHandoffComplete: true,
      platformPartner: false,
    })
    renderRecovery()

    expect(screen.getByRole('heading', { name: '重新进入练习' })).toBeInTheDocument()
    expect(screen.getByText(/练习关卡/)).toBeInTheDocument()
    expect(screen.queryByText(/每日挑战/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /直接进入练习/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('/bombsquad/run?mode=practice')
  })
})
