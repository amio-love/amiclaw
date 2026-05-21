/**
 * GamesPage (platform homepage) integration tests.
 *
 * Covers the `/` route — the Amiclaw「星图 / Atlas」homepage:
 *   1. anonymous `/` renders the AnonHero
 *   2. the daily-challenge CTA opens the daily PromptModal
 *   3. confirming the daily modal navigates to /game?mode=daily
 *   4. the featured-BombSquad「开始一局」CTA opens the daily PromptModal
 *   5. the featured-BombSquad「练习」CTA opens the practice modal and
 *      confirming navigates to /game?mode=practice
 *   6. a signed-in visitor (?auth=in) renders the WelcomeStrip, not the hero
 *
 * Follows the LeaderboardPage.test.tsx pattern: render the page directly
 * inside a MemoryRouter. A sibling `/game` route renders a location probe so
 * the post-confirm navigation target is assertable without a real GamePage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import GamesPage from './GamesPage'

// The daily countdown ticks on a setInterval; these tests never assert on it.
// Mock it to a static tuple so the suite carries no live timer.
vi.mock('@/hooks/useDailyCountdown', () => ({
  useDailyCountdown: () => ['12', '00', '00'],
}))

/* Renders the current location so the navigation target after a modal
   confirmation is assertable without mounting the real GamePage. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderHomepage(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<GamesPage />} />
        <Route path="/game" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('GamesPage homepage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    // ?auth=in persists to localStorage; clear it so each test starts signed
    // out. The jsdom localStorage in this workspace can be non-functional —
    // ignore failures.
    try {
      localStorage.clear()
    } catch {
      // ignore storage failures (private mode, non-functional jsdom stub)
    }
  })

  it('renders the anonymous hero on / for a signed-out visitor', () => {
    renderHomepage('/')

    // AnonHero markers: the hero eyebrow pill and the primary「开启旅程」CTA.
    expect(screen.getByText('本周开服 · BOMBSQUAD 公测中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开启旅程/ })).toBeInTheDocument()
    // The signed-in WelcomeStrip greets the mock user by name — it must NOT
    // be present for an anonymous visitor.
    expect(screen.queryByText('星海')).not.toBeInTheDocument()
  })

  it('opens the daily PromptModal when the daily-challenge CTA is clicked', () => {
    renderHomepage('/')

    // No modal is mounted before the CTA is clicked.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /立即挑战/ }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('每日 Prompt')).toBeInTheDocument()
  })

  it('navigates to /game?mode=daily after confirming the daily modal', () => {
    renderHomepage('/')

    fireEvent.click(screen.getByRole('button', { name: /立即挑战/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认开始游戏' }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/game')
    expect(location).toContain('mode=daily')
  })

  it('opens the daily PromptModal from the featured-BombSquad「开始一局」CTA', () => {
    renderHomepage('/')

    fireEvent.click(screen.getByRole('button', { name: '开始一局' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('每日 Prompt')).toBeInTheDocument()
  })

  it('navigates to /game?mode=practice after confirming the featured practice modal', () => {
    renderHomepage('/')

    fireEvent.click(screen.getByRole('button', { name: '练习' }))

    // The practice CTA opens the practice-variant modal.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('练习 Prompt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认开始游戏' }))

    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/game')
    expect(location).toContain('mode=practice')
  })

  it('renders the WelcomeStrip instead of the hero for a signed-in visitor', () => {
    renderHomepage('/?auth=in')

    // WelcomeStrip greets the mock user by display name.
    expect(screen.getByText('星海')).toBeInTheDocument()
    // The anonymous hero CTA must NOT be present.
    expect(screen.queryByRole('button', { name: /开启旅程/ })).not.toBeInTheDocument()
  })
})
