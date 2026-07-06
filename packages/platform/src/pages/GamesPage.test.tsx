/**
 * GamesPage (platform homepage) integration tests.
 *
 * Covers the `/` route — the AMIO Arcade「星图 / Atlas」homepage:
 *   1. anonymous `/` renders the AnonHero
 *   2. the anonymous hero「开始玩」CTA routes to /bombsquad
 *   3. a signed-in visitor renders the WelcomeStrip (greeting by the
 *      session-derived display name), not the hero
 *
 * The homepage has a single in-page play CTA — the AnonHero primary「开始玩」
 * (the other play entry is the TopNav, rendered by the app shell, not here).
 * FeaturedBombSquad is the single BombSquad overview block: it combines the
 * game pitch and daily countdown without repeating leaderboard data.
 * FooterPitch is a pure pitch block with no play button. The CTA routes to the
 * BombSquad landing page; the landing owns the daily/practice choice and the
 * connect-AI flow, so the homepage no longer opens a pre-game modal. The
 * landing → connect → run path is covered by the screen tests.
 *
 * Render the page directly inside a MemoryRouter. Auth is the real session
 * fetch: each test stubs global.fetch (anonymous by default) before render.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { fetchLeaderboard } from '@shared/leaderboard-api'
import type { SessionResponse } from '@shared/auth-types'
import { ARCADE_LOCAL_PROFILE_KEY } from '@amiclaw/arcade-profile/local'
import GamesPage from './GamesPage'

// The daily countdown ticks on a setInterval; these tests never assert on live
// time. FeaturedBombSquad renders @amiclaw/ui's DailyCountdown, which consumes
// the useDailyCountdown hook directly, so mock the hook module to a static
// tuple and keep the suite deterministic.
vi.mock('../../../ui/src/useDailyCountdown', () => ({
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

const ANON: SessionResponse = { authenticated: false, identity: null }
const AUTHED: SessionResponse = {
  authenticated: true,
  identity: { user_id: 'u_1', email: 'nova@amio.fans' },
}

const EMPTY_ARCADE_PROFILE = {
  last_activity_at: null,
  today_played: false,
  counts: { bombsquad_runs: 0, oracle_signs: 0 },
  bombsquad: { recent: null, best_daily: null, best_practice: null },
  oracle: { recent: null },
  daily_loop: {
    date: '2026-07-06',
    checklist: {
      bombsquad_daily: { completed: false, completed_at: null },
      oracle_sign: { completed: false, completed_at: null },
    },
    streak: {
      today_completed: false,
      current_days: 0,
      longest_days: 0,
      last_active_date: null,
    },
  },
}

const ACCOUNT_ARCADE_PROFILE = {
  ...EMPTY_ARCADE_PROFILE,
  last_activity_at: '2026-07-06T08:00:00.000Z',
  today_played: true,
  counts: { bombsquad_runs: 1, oracle_signs: 0 },
  daily_loop: {
    date: '2026-07-06',
    checklist: {
      bombsquad_daily: { completed: true, completed_at: '2026-07-06T08:00:00.000Z' },
      oracle_sign: { completed: false, completed_at: null },
    },
    streak: {
      today_completed: true,
      current_days: 3,
      longest_days: 4,
      last_active_date: '2026-07-06',
    },
  },
}

/** Stub real API reads used by useAuth and the homepage profile checklist. */
function stubApi(body: SessionResponse, arcadeProfile: unknown = EMPTY_ARCADE_PROFILE) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/api/arcade/profile')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              profile: arcadeProfile,
              public_profile: { claimed: false, public_label: null },
            }),
            { status: 200 }
          )
        )
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
  )
}

function installFakeLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  })
  return store
}

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
    // Default to anonymous; the signed-in test overrides before rendering.
    stubApi(ANON)
    vi.stubGlobal('location', { ...window.location, assign: assignSpy })
    // Default every test to an empty daily board (beta reality). Individual
    // tests can override before rendering when they need populated rows.
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue({ date: '2026-06-07', entries: [] })
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the anonymous hero on / for a signed-out visitor', async () => {
    renderHomepage('/')

    // AnonHero markers: the hero eyebrow pill, platform description, and the
    // single primary「开始玩」CTA.
    expect(await screen.findByText('本周开服 · BOMBSQUAD 公测中')).toBeInTheDocument()
    expect(
      screen.getByText(
        (_, el) =>
          el?.textContent ===
          'AMIO 游乐场是你和 AI 伙伴的轻量体验入口。带上你的 AI 伙伴，来玩一局。'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始玩/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /看看 BombSquad/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/一起拆弹/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '今日清单' })).toBeInTheDocument()
    expect(screen.getByText('今天还没打卡')).toBeInTheDocument()
  })

  it('routes to the BombSquad landing from the anonymous hero「开始玩」CTA', async () => {
    renderHomepage('/')

    fireEvent.click(await screen.findByRole('button', { name: /开始玩/ }))

    expect(assignSpy).toHaveBeenCalledWith('/bombsquad/')
  })

  it('renders the WelcomeStrip instead of the hero for a signed-in visitor', async () => {
    stubApi(AUTHED, ACCOUNT_ARCADE_PROFILE)
    renderHomepage('/')

    // WelcomeStrip greets by the session-derived display name (nova@... → nova).
    expect(await screen.findByText('nova', { exact: true })).toBeInTheDocument()
    expect(await screen.findByText('今日已打卡')).toBeInTheDocument()
    expect(screen.getByText('连续天数 · 本账号')).toBeInTheDocument()
    // The anonymous hero eyebrow must NOT be present.
    expect(screen.queryByText('本周开服 · BOMBSQUAD 公测中')).not.toBeInTheDocument()
  })

  it('shows local daily checklist completion for an anonymous visitor', async () => {
    const store = installFakeLocalStorage()
    const today = new Date().toISOString().slice(0, 10)
    store.set(
      ARCADE_LOCAL_PROFILE_KEY,
      JSON.stringify({
        version: 1,
        profile_id: 'local-profile',
        created_at: `${today}T07:00:00.000Z`,
        updated_at: `${today}T08:00:00.000Z`,
        last_seen_at: `${today}T08:00:00.000Z`,
        claimed_source_keys: [],
        bombsquad_runs: [
          {
            source_key: 'bombsquad:local-run',
            run_id: 'local-run',
            mode: 'daily',
            outcome: 'defused',
            duration_ms: 42_000,
            attempt_number: 1,
            module_count: 4,
            completed_modules: 4,
            strike_count: 0,
            finished_at: `${today}T08:00:00.000Z`,
          },
        ],
        oracle_signs: [],
      })
    )

    renderHomepage('/')

    expect(await screen.findByText('今日已打卡')).toBeInTheDocument()
    expect(screen.getByText('已完成 · 08:00 UTC')).toBeInTheDocument()
    expect(screen.getByText('连续天数 · 本设备')).toBeInTheDocument()
  })

  it('shows honest empty / zero states when the real daily board is empty', async () => {
    renderHomepage('/')

    // FeaturedBombSquad is the only BombSquad homepage block: the former
    // standalone daily card is gone, and this block no longer includes
    // leaderboard surfaces.
    await screen.findByText('正在开放 · NOW PLAYING')
    expect(screen.getByText('正在开放 · NOW PLAYING')).toBeInTheDocument()
    expect(screen.getByText('今日挑战')).toBeInTheDocument()
    expect(screen.queryByText(/4 模块/)).not.toBeInTheDocument()
    expect(screen.queryByText('每日同题')).not.toBeInTheDocument()
    expect(screen.queryByText('每日挑战 · DAILY DROP')).not.toBeInTheDocument()
    expect(screen.queryByText('今日：四模块连拆')).not.toBeInTheDocument()
    // The hero's static platform stat counts playable games, not supported AI
    // tools.
    expect(
      screen.getByText((_, el) => el?.textContent?.replace(/\s+/g, '') === '2已上线游戏')
    ).toBeInTheDocument()
    expect(screen.queryByText(/支持 AI 模型/)).not.toBeInTheDocument()
    // Leaderboard data is not repeated inside the BombSquad card.
    expect(screen.queryByText('日榜首')).not.toBeInTheDocument()
    expect(screen.queryByText('今日日榜')).not.toBeInTheDocument()
    expect(screen.queryByText('暂无成绩')).not.toBeInTheDocument()

    // None of the old fabricated stats / mock leaderboard rows render.
    expect(screen.queryByText(/1,287/)).not.toBeInTheDocument()
    expect(screen.queryByText(/本周在线/)).not.toBeInTheDocument()
    expect(screen.queryByText('林星海（你）')).not.toBeInTheDocument()
    expect(screen.queryByText(/42秒|最快拆弹/)).not.toBeInTheDocument()
  })

  it('does not repeat leaderboard rows in the featured panel when the daily board has scores', async () => {
    mockedFetch.mockResolvedValue({
      date: '2026-06-07',
      entries: [
        { rank: 1, nickname: '阿尔法', time_ms: 65000, attempt_number: 2, ai_tool: 'claude' },
        { rank: 2, nickname: 'beta', time_ms: 88000, attempt_number: 1, ai_tool: 'chatgpt' },
      ],
    })

    renderHomepage('/')

    await screen.findByText('正在开放 · NOW PLAYING')
    expect(screen.queryByText('阿尔法')).not.toBeInTheDocument()
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
    expect(screen.queryByText('日榜首')).not.toBeInTheDocument()
    expect(screen.queryByText('暂无成绩')).not.toBeInTheDocument()
  })
})
