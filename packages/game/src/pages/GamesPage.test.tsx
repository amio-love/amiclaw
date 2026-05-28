/**
 * GamesPage (platform homepage) integration tests.
 *
 * Covers the `/` route — the Amiclaw「星图 / Atlas」homepage:
 *   1. anonymous `/` renders the AnonHero
 *   2. the daily-challenge CTA routes to the BombSquad landing (/bombsquad)
 *   3. the featured-BombSquad「开始一局」CTA routes to /bombsquad
 *   4. the featured-BombSquad「练习」CTA routes to /bombsquad
 *   5. the anonymous hero「开启旅程」CTA routes to /bombsquad
 *   6. a signed-in visitor (?auth=in) renders the WelcomeStrip, not the hero
 *
 * Every BombSquad CTA on the homepage now routes to the BombSquad landing
 * page; the landing owns the daily/practice choice and the connect-AI
 * flow, so the homepage no longer opens a pre-game modal. The
 * landing → connect → run path is covered by the screen tests.
 *
 * Render the page directly inside a MemoryRouter. A sibling `/bombsquad`
 * route renders a location probe so the navigation target is assertable
 * without mounting the real BombSquad landing page.
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

/* Renders the current location so the navigation target after a CTA
   click is assertable without mounting the real landing page. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderHomepage(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<GamesPage />} />
        <Route path="/bombsquad" element={<LocationProbe />} />
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

  it('routes to the BombSquad landing when the daily-challenge CTA is clicked', () => {
    renderHomepage('/')

    fireEvent.click(screen.getByRole('button', { name: /立即挑战/ }))

    expect(screen.getByTestId('location').textContent).toBe('/bombsquad')
  })

  it('routes to the BombSquad landing from the featured「开始一局」CTA', () => {
    renderHomepage('/')

    fireEvent.click(screen.getByRole('button', { name: '开始一局' }))

    expect(screen.getByTestId('location').textContent).toBe('/bombsquad')
  })

  it('routes to the BombSquad landing from the featured「练习」CTA', () => {
    renderHomepage('/')

    fireEvent.click(screen.getByRole('button', { name: '练习' }))

    expect(screen.getByTestId('location').textContent).toBe('/bombsquad')
  })

  it('routes to the BombSquad landing from the anonymous hero「开启旅程」CTA', () => {
    renderHomepage('/')

    fireEvent.click(screen.getByRole('button', { name: /开启旅程/ }))

    expect(screen.getByTestId('location').textContent).toBe('/bombsquad')
  })

  it('renders the WelcomeStrip instead of the hero for a signed-in visitor', () => {
    renderHomepage('/?auth=in')

    // WelcomeStrip greets the mock user by display name.
    expect(screen.getByText('星海')).toBeInTheDocument()
    // The anonymous hero CTA must NOT be present.
    expect(screen.queryByRole('button', { name: /开启旅程/ })).not.toBeInTheDocument()
  })
})
