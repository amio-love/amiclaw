/**
 * GamesPage (platform homepage) integration tests.
 *
 * Covers the `/` route — the Amiclaw「星图 / Atlas」homepage:
 *   1. anonymous `/` renders the AnonHero
 *   2. the anonymous hero「开始玩」CTA routes to /bombsquad
 *   3. a signed-in visitor (?auth=in) renders the WelcomeStrip, not the hero
 *
 * The homepage has a single in-page play CTA — the AnonHero primary「开始玩」
 * (the other play entry is the TopNav, rendered by the app shell, not here).
 * The DailyChallenge / FeaturedBombSquad / FooterPitch sections are pure
 * info / pitch blocks with no play button. The CTA routes to the BombSquad
 * landing page; the landing owns the daily/practice choice and the
 * connect-AI flow, so the homepage no longer opens a pre-game modal. The
 * landing → connect → run path is covered by the screen tests.
 *
 * Render the page directly inside a MemoryRouter. A sibling `/bombsquad`
 * route renders a location probe so the navigation target is assertable
 * without mounting the real BombSquad landing page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { fetchLeaderboard } from '@shared/leaderboard-api'
import GamesPage from './GamesPage'

// The daily countdown ticks on a setInterval; these tests never assert on it.
// Mock it to a static tuple so the suite carries no live timer. The hook now
// lives in @amiclaw/ui, so the rest of the barrel must be preserved.
vi.mock('@amiclaw/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@amiclaw/ui')>()),
  useDailyCountdown: () => ['12', '00', '00'],
}))

// Every「今日 / 在线 / 日榜」surface on the homepage reads ONE real source —
// the daily leaderboard API, fetched once via useDailyBoard(). Mock it so the
// suite carries no live fetch; default to an EMPTY board so the homepage must
// render its honest empty / zero states (no fabricated counts or mock rows).
vi.mock('@shared/leaderboard-api', () => ({
  fetchLeaderboard: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchLeaderboard)

// BombSquad now lives in its own SPA at /bombsquad/, so the homepage CTAs cross
// the app boundary with a full-page navigation rather than a client-side router
// push. Spy on window.location.assign to assert the target.
const assignSpy = vi.fn()

function renderHomepage(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<GamesPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('GamesPage homepage', () => {
  beforeEach(() => {
    assignSpy.mockClear()
    vi.stubGlobal('location', { ...window.location, assign: assignSpy })
    // Default every test to an empty daily board (beta reality). Individual
    // tests can override before rendering when they need populated rows.
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue({ date: '2026-06-07', entries: [] })
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

    // AnonHero markers: the hero eyebrow pill and the primary「开始玩」CTA.
    expect(screen.getByText('本周开服 · BOMBSQUAD 公测中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始玩/ })).toBeInTheDocument()
    // The signed-in WelcomeStrip greets the mock user by name — it must NOT
    // be present for an anonymous visitor.
    expect(screen.queryByText('星海')).not.toBeInTheDocument()
  })

  it('routes to the BombSquad landing from the anonymous hero「开始玩」CTA', () => {
    renderHomepage('/')

    fireEvent.click(screen.getByRole('button', { name: /开始玩/ }))

    expect(assignSpy).toHaveBeenCalledWith('/bombsquad/')
  })

  it('renders the WelcomeStrip instead of the hero for a signed-in visitor', () => {
    renderHomepage('/?auth=in')

    // WelcomeStrip greets the mock user by display name.
    expect(screen.getByText('星海')).toBeInTheDocument()
    // The anonymous hero CTA must NOT be present.
    expect(screen.queryByRole('button', { name: /开始玩/ })).not.toBeInTheDocument()
  })

  it('shows honest empty / zero states when the real daily board is empty', async () => {
    renderHomepage('/')

    // DailyChallenge derives 今日上榜 from the board: 0 on an empty board.
    await screen.findByText((_, el) => el?.textContent === '今日上榜 0')
    // 日榜首 shows the no-leader placeholder, not a fabricated time.
    expect(screen.getByText((_, el) => el?.textContent === '日榜首 —')).toBeInTheDocument()
    // FeaturedBombSquad shows the daily board's own empty-state copy, not rows.
    expect(screen.getByText('今日还没有成绩，来抢第一！')).toBeInTheDocument()

    // None of the old fabricated stats / mock leaderboard rows render.
    expect(screen.queryByText(/1,287/)).not.toBeInTheDocument()
    expect(screen.queryByText(/本周在线/)).not.toBeInTheDocument()
    expect(screen.queryByText('林星海（你）')).not.toBeInTheDocument()
    expect(screen.queryByText(/42秒|最快拆弹/)).not.toBeInTheDocument()
  })

  it('renders real board rows in the featured panel when the daily board has scores', async () => {
    mockedFetch.mockResolvedValue({
      date: '2026-06-07',
      entries: [
        { rank: 1, nickname: '阿尔法', time_ms: 65000, attempt_number: 2, ai_tool: 'claude' },
        { rank: 2, nickname: 'beta', time_ms: 88000, attempt_number: 1, ai_tool: 'chatgpt' },
      ],
    })

    renderHomepage('/')

    // The mini board shows the real top rows.
    await screen.findByText('阿尔法')
    expect(screen.getByText('beta')).toBeInTheDocument()
    // DailyChallenge reflects the real on-board count and leader time.
    expect(screen.getByText((_, el) => el?.textContent === '今日上榜 2')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent === '日榜首 01:05')).toBeInTheDocument()
    // The empty-state copy is gone once there are rows.
    expect(screen.queryByText('今日还没有成绩，来抢第一！')).not.toBeInTheDocument()
  })
})
