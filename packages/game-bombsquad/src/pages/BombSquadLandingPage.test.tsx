/**
 * BombSquadLandingPage unit tests.
 *
 * Covers the BombSquad game landing page (/bombsquad) — the Atlas
 * star-chart redesign (design_handoff_bombsquad README §6.1):
 *   1. render smoke — planet hero, BOMBSQUAD title, the bring-your-own-AI
 *      eyebrow, and the daily-countdown card.
 *   2. both the 练习 and 每日挑战 CTAs render.
 *   3. the 每日挑战 CTA enters the connect flow as mode=daily.
 *   4. the 练习 CTA enters the connect flow as mode=practice.
 *
 * useDailyCountdown ticks on a setInterval; it is mocked to a static tuple
 * so the suite carries no live timer. Navigation targets are asserted with
 * a sibling-route location probe — the same pattern GamesPage.test.tsx uses.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import BombSquadLandingPage from './BombSquadLandingPage'

// The daily-reset clock now lives inside @amiclaw/ui's DailyCountdown, which
// consumes the useDailyCountdown hook directly. Mock the hook module (the same
// one DailyCountdown imports) to a static tuple so the suite carries no live
// timer.
vi.mock('../../../ui/src/useDailyCountdown', () => ({
  useDailyCountdown: () => ['07', '30', '00'],
}))

// The landing now reads the real daily board for its 日榜首 / 参与 stats.
// Mock the shared API to an empty board so the suite carries no live fetch and
// the stats render their honest empty / zero states.
vi.mock('@shared/leaderboard-api', () => ({
  fetchLeaderboard: vi.fn().mockResolvedValue({ date: '2026-06-07', entries: [] }),
}))

/* Renders the current location so the navigation target after a CTA
   click is assertable without mounting the real ConnectPage. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/bombsquad']}>
      <Routes>
        <Route path="/bombsquad" element={<BombSquadLandingPage />} />
        <Route path="/bombsquad/connect" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('BombSquadLandingPage', () => {
  it('renders the planet hero, the BOMBSQUAD title and the daily-countdown card', () => {
    renderLanding()

    // Title — the h1 splits BOMB / SQUAD across a span; its accessible
    // name concatenates back to "BOMBSQUAD".
    expect(screen.getByRole('heading', { level: 1, name: 'BOMBSQUAD' })).toBeInTheDocument()
    // Hero copy markers.
    expect(screen.getByText('拆弹小队')).toBeInTheDocument()
    expect(screen.getByText(/人机协作 · 语音拆弹挑战/)).toBeInTheDocument()
    // Bring-your-own-AI premise eyebrow (not a status claim). The AI-tools
    // list now emphasizes each tool name in its own span, so the prefix is its
    // own text node. 「自带任意 …· 例如」 frames the tools as EXAMPLES you can
    // bring (BYO), not a roster of supported/verified providers — the audit-F2
    // honesty fix that also kills the「支持 N 家 → 内置 AI」misread.
    expect(screen.getByText(/自带任意语音 AI · 例如/)).toBeInTheDocument()
    expect(screen.queryByText(/自带语音 AI · 支持/)).not.toBeInTheDocument()
    // Daily-countdown card — its label plus the mocked countdown digits.
    // The countdown splits the `:` separators into <span> elements, so the
    // digits are loose text nodes — match on the element's full textContent.
    expect(screen.getByText('今日挑战 · 重置')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent === '07:30:00')).toBeInTheDocument()
    expect(screen.getByText(/日榜首/)).toBeInTheDocument()
  })

  it('shows honest empty-board stats — never the fabricated 1,287 / 00:42', async () => {
    renderLanding()

    // 今日上榜 reflects the real (empty) board: 0, not the old fabricated 1,287.
    await screen.findByText((_, el) => el?.textContent === '今日上榜 0')
    // 日榜首 shows the no-leader placeholder, not the old fabricated 00:42.
    expect(screen.getByText((_, el) => el?.textContent === '日榜首 —')).toBeInTheDocument()
    expect(screen.queryByText(/1,287/)).not.toBeInTheDocument()
    expect(screen.queryByText(/00:42/)).not.toBeInTheDocument()
  })

  it('renders both the 练习 and 每日挑战 CTAs', () => {
    renderLanding()
    expect(screen.getByRole('button', { name: '练习' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /每日挑战/ })).toBeInTheDocument()
  })

  it('enters the connect flow as mode=daily when 每日挑战 is clicked', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('button', { name: /每日挑战/ }))
    expect(screen.getByTestId('location').textContent).toBe('/bombsquad/connect?mode=daily')
  })

  it('enters the connect flow as mode=practice when 练习 is clicked', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('button', { name: '练习' }))
    expect(screen.getByTestId('location').textContent).toBe('/bombsquad/connect?mode=practice')
  })
})
