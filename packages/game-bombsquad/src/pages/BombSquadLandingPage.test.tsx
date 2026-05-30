/**
 * BombSquadLandingPage unit tests.
 *
 * Covers the BombSquad game landing page (/bombsquad) — the Atlas
 * star-chart redesign (design_handoff_bombsquad README §6.1):
 *   1. render smoke — planet hero, BOMBSQUAD title, the AI-status eyebrow,
 *      and the daily-countdown card.
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

// The hook now lives in @amiclaw/ui; preserve the rest of the barrel.
vi.mock('@amiclaw/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@amiclaw/ui')>()),
  useDailyCountdown: () => ['07', '30', '00'],
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
    // AI-status eyebrow.
    expect(screen.getByText(/AI 已就位 · Claude · 语音模式/)).toBeInTheDocument()
    // Daily-countdown card — its label plus the mocked countdown digits.
    // The countdown splits the `:` separators into <span> elements, so the
    // digits are loose text nodes — match on the element's full textContent.
    expect(screen.getByText('今日挑战 · 重置')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent === '07:30:00')).toBeInTheDocument()
    expect(screen.getByText(/日榜首/)).toBeInTheDocument()
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
