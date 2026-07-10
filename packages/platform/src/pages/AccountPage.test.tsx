/**
 * AccountPage (/me) integration tests.
 *
 * The page branches on the real useAuth() (async `GET /api/auth/session`):
 *   1. signed-out `/me` renders a login-guide empty state (heading + a
 *      plain-text unlock preview + a 登录 CTA) and NONE of a fake profile.
 *   2. the signed-out CTA navigates to the magic-link /login page.
 *   3. signed-in `/me` renders the real-identity profile (display name derived
 *      from the session email) plus the honest empty stats state — NOT mock
 *      numbers, NOT a recent-runs table or badge grid.
 *
 * Render the page directly inside a MemoryRouter. A sibling /login route
 * renders a location probe so the CTA's navigation target is assertable. Auth
 * is the real session fetch: each test stubs global.fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { SessionResponse } from '@shared/auth-types'
import { ARCADE_LOCAL_PROFILE_KEY } from '@amiclaw/arcade-profile/local'
import { __resetCompanionStore } from '@/hooks/useCompanion'
import AccountPage from './AccountPage'

/** Resolve any fetch input to its URL string. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url
}

/**
 * Stub the two reads the page makes: GET /api/auth/session (auth) and
 * GET /api/companion (the companion card). Companion defaults to 404 (no
 * companion yet → the "认识你的伙伴" setup CTA); pass `companion` to override.
 */
function stubApi(opts: {
  session: SessionResponse
  arcadeProfile?: unknown
  companion?: { status: number; body?: unknown }
}) {
  const companion = opts.companion ?? { status: 404, body: { error: 'no companion set up' } }
  const arcadeProfile = opts.arcadeProfile ?? {
    profile: EMPTY_ARCADE_PROFILE,
    public_profile: { claimed: false, public_label: null },
  }
  const fetchSpy = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.includes('/api/arcade/profile/claim')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            profile: ACCOUNT_ARCADE_PROFILE,
            source_keys: ['bombsquad:local-run'],
            inserted: 1,
            public_profile: { claimed: true, public_label: 'Player 8F3A' },
          }),
          { status: 200 }
        )
      )
    }
    if (url.includes('/api/arcade/profile')) {
      return Promise.resolve(new Response(JSON.stringify(arcadeProfile), { status: 200 }))
    }
    if (url.includes('/api/companion')) {
      return Promise.resolve(
        new Response(companion.body === undefined ? null : JSON.stringify(companion.body), {
          status: companion.status,
        })
      )
    }
    return Promise.resolve(new Response(JSON.stringify(opts.session), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

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
  history: [],
}

const ACCOUNT_ARCADE_PROFILE = {
  profile_id: 'local-profile',
  last_activity_at: '2026-07-06T08:00:00.000Z',
  today_played: true,
  counts: { bombsquad_runs: 1, oracle_signs: 1 },
  bombsquad: {
    recent: {
      source_key: 'bombsquad:account-run',
      run_id: 'account-run',
      mode: 'daily',
      outcome: 'defused',
      duration_ms: 65_000,
      attempt_number: 1,
      module_count: 4,
      completed_modules: 4,
      strike_count: 0,
      finished_at: '2026-07-06T08:00:00.000Z',
    },
    best_daily: {
      source_key: 'bombsquad:account-run',
      run_id: 'account-run',
      mode: 'daily',
      outcome: 'defused',
      duration_ms: 65_000,
      attempt_number: 1,
      module_count: 4,
      completed_modules: 4,
      strike_count: 0,
      finished_at: '2026-07-06T08:00:00.000Z',
    },
    best_practice: null,
  },
  oracle: {
    recent: {
      source_key: 'oracle:2026-07-06:oracle-1',
      session_id: 'oracle-1',
      sign_date: '2026-07-06',
      ben: '乾',
      bian: '坤',
      yao_values: [7, 8, 7, 8, 7, 8],
      created_at: '2026-07-06T09:00:00.000Z',
    },
  },
  daily_loop: {
    date: '2026-07-06',
    checklist: {
      bombsquad_daily: { completed: true, completed_at: '2026-07-06T08:00:00.000Z' },
      oracle_sign: { completed: true, completed_at: '2026-07-06T09:00:00.000Z' },
    },
    streak: {
      today_completed: true,
      current_days: 1,
      longest_days: 1,
      last_active_date: '2026-07-06',
    },
  },
  // Last-7-days record view (today first). The history section labels rows by
  // array index (今天 / 昨天 / …), so fixed dates are fine here.
  history: [
    {
      date: '2026-07-06',
      bombsquad_daily_completed: true,
      oracle_signed: true,
      runs: 1,
      best_daily: {
        source_key: 'bombsquad:account-run',
        run_id: 'account-run',
        mode: 'daily',
        outcome: 'defused',
        duration_ms: 65_000,
        attempt_number: 1,
        module_count: 4,
        completed_modules: 4,
        strike_count: 0,
        finished_at: '2026-07-06T08:00:00.000Z',
      },
      sign: {
        source_key: 'oracle:2026-07-06:oracle-1',
        session_id: 'oracle-1',
        sign_date: '2026-07-06',
        ben: '乾',
        bian: '坤',
        yao_values: [7, 8, 7, 8, 7, 8],
        created_at: '2026-07-06T09:00:00.000Z',
      },
    },
    {
      date: '2026-07-05',
      bombsquad_daily_completed: true,
      oracle_signed: false,
      runs: 2,
      best_daily: {
        source_key: 'bombsquad:yesterday-run',
        run_id: 'yesterday-run',
        mode: 'daily',
        outcome: 'defused',
        duration_ms: 83_000,
        attempt_number: 2,
        module_count: 4,
        completed_modules: 4,
        strike_count: 1,
        finished_at: '2026-07-05T08:00:00.000Z',
      },
      sign: null,
    },
    ...['2026-07-04', '2026-07-03', '2026-07-02', '2026-07-01', '2026-06-30'].map((date) => ({
      date,
      bombsquad_daily_completed: false,
      oracle_signed: false,
      runs: 0,
      best_daily: null,
      sign: null,
    })),
  ],
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

function seedLocalProfile(store: Map<string, string>) {
  store.set(
    ARCADE_LOCAL_PROFILE_KEY,
    JSON.stringify({
      version: 1,
      profile_id: 'local-profile',
      created_at: '2026-07-06T07:00:00.000Z',
      updated_at: '2026-07-06T08:00:00.000Z',
      last_seen_at: '2026-07-06T08:00:00.000Z',
      claimed_source_keys: [],
      bombsquad_runs: [
        {
          source_key: 'bombsquad:local-run',
          run_id: 'local-run',
          mode: 'practice',
          outcome: 'practice-cleared',
          duration_ms: 42_000,
          attempt_number: 1,
          module_count: 2,
          completed_modules: 2,
          strike_count: 0,
          finished_at: '2026-07-06T08:00:00.000Z',
        },
      ],
      oracle_signs: [],
    })
  )
}

function renderAccount(entry = '/me') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/me" element={<AccountPage />} />
        <Route path="/login" element={<div>LOGIN PROBE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AccountPage /me', () => {
  let localStore: Map<string, string>

  beforeEach(() => {
    localStore = installFakeLocalStorage()
    __resetCompanionStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders real local profile data and no fake profile for a signed-out visitor', async () => {
    seedLocalProfile(localStore)
    stubApi({ session: ANON })
    renderAccount('/me')

    expect(await screen.findByText('你的星轨。')).toBeInTheDocument()
    expect(screen.getByText('练习 · 00:42 · 最快 00:42')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '登录' })).toBeInTheDocument()

    // B12 断签说明 — relocated behind the ⓘ (rc §3 progressive disclosure).
    // Not on the default surface; revealed on demand, honest and non-punitive.
    expect(screen.queryByText(/断一天，连续天数会从头算起。/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '连续打卡与刷新说明' }))
    expect(
      screen.getByText(
        /断一天，连续天数会从头算起。最长记录和已保存的成绩都还在，错过一天不会有惩罚。/
      )
    ).toBeInTheDocument()

    // None of the retired mock-profile content may render for anyone now.
    expect(screen.queryByText('星海')).not.toBeInTheDocument()
    expect(screen.queryByText('林星海')).not.toBeInTheDocument()
    expect(screen.queryByText('42')).not.toBeInTheDocument()
    expect(screen.queryByText('最近 5 局')).not.toBeInTheDocument()
    expect(screen.queryByText('勋章', { exact: true })).not.toBeInTheDocument()
  })

  it("keeps yesterday's device records visible in the 最近 7 天 history", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    const yesterdayDate = yesterday.slice(0, 10)
    localStore.set(
      ARCADE_LOCAL_PROFILE_KEY,
      JSON.stringify({
        version: 1,
        profile_id: 'local-profile',
        created_at: yesterday,
        updated_at: yesterday,
        last_seen_at: yesterday,
        claimed_source_keys: [],
        bombsquad_runs: [
          {
            source_key: 'bombsquad:yesterday-run',
            run_id: 'yesterday-run',
            mode: 'daily',
            outcome: 'defused',
            duration_ms: 78_000,
            attempt_number: 1,
            module_count: 4,
            completed_modules: 4,
            strike_count: 0,
            finished_at: yesterday,
          },
        ],
        oracle_signs: [
          {
            source_key: `oracle:${yesterdayDate}:oracle-1`,
            session_id: 'oracle-1',
            sign_date: yesterdayDate,
            ben: '乾',
            bian: '坤',
            yao_values: [7, 8, 7, 8, 7, 8],
            created_at: yesterday,
          },
        ],
      })
    )
    stubApi({ session: ANON })
    renderAccount('/me')

    expect(await screen.findByText('最近 7 天')).toBeInTheDocument()
    const yesterdayRows = screen
      .getAllByRole('row')
      .filter((row) => row.textContent?.includes('昨天'))
    expect(yesterdayRows).toHaveLength(1)
    expect(yesterdayRows[0]).toHaveTextContent('✓ 01:18')
    expect(yesterdayRows[0]).toHaveTextContent('乾 → 坤')
  })

  it('navigates to /login when the signed-out CTA is clicked', async () => {
    stubApi({ session: ANON })
    renderAccount('/me')

    fireEvent.click(await screen.findByRole('link', { name: '登录' }))

    expect(screen.getByText('LOGIN PROBE')).toBeInTheDocument()
  })

  it('renders the real-identity profile with an honest empty stats state', async () => {
    stubApi({
      session: AUTHED,
      arcadeProfile: {
        profile: ACCOUNT_ARCADE_PROFILE,
        public_profile: { claimed: true, public_label: 'Player 8F3A' },
      },
    })
    renderAccount('/me')

    // No chosen nickname and no companion → a neutral, name-free greeting; the
    // email local-part「nova」is never rendered as a name (audit F19). The full
    // email stays as the explicit account-identity line (not a name fallback).
    expect(await screen.findByText('你的星轨。')).toBeInTheDocument()
    expect(screen.queryByText('nova', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText('nova@amio.fans')).toBeInTheDocument()
    // Account stats are read from /api/arcade/profile, not invented locally.
    expect(await screen.findByText('账号记录')).toBeInTheDocument()
    expect(await screen.findByText('1 天')).toBeInTheDocument()
    expect(screen.getByText('每日挑战 · 01:05 · 最快 01:05')).toBeInTheDocument()
    expect(screen.getAllByText('乾 → 坤').length).toBeGreaterThan(0)
    expect(screen.getByText('上榜名：Player 8F3A')).toBeInTheDocument()
    // The last-7-days history keeps yesterday's records visible after rollover.
    expect(screen.getByText('最近 7 天')).toBeInTheDocument()
    const historyRows = screen
      .getAllByRole('row')
      .filter((row) => row.textContent?.includes('昨天'))
    expect(historyRows).toHaveLength(1)
    expect(historyRows[0]).toHaveTextContent('✓ 01:23')
    // The retired mock stats / runs / badges must be absent.
    expect(screen.queryByText('林星海')).not.toBeInTheDocument()
    expect(screen.queryByText('42')).not.toBeInTheDocument()
    expect(screen.queryByText('最近 5 局')).not.toBeInTheDocument()
    // The login-guide empty state must NOT be present.
    expect(screen.queryByText('本设备的星轨。')).not.toBeInTheDocument()
  })

  it('auto-claims the current device records into the account on login (F7)', async () => {
    seedLocalProfile(localStore)
    const fetchSpy = stubApi({
      session: AUTHED,
      arcadeProfile: {
        profile: EMPTY_ARCADE_PROFILE,
        public_profile: { claimed: false, public_label: null },
      },
    })
    renderAccount('/me')

    // No manual tap — the claim fires automatically once signed in.
    expect(await screen.findByText('已保存')).toBeInTheDocument()
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some((call) => urlOf(call[0]).includes('/api/arcade/profile/claim'))
      ).toBe(true)
    })
    await waitFor(() => {
      const raw = localStore.get(ARCADE_LOCAL_PROFILE_KEY)
      expect(raw).toContain('bombsquad:local-run')
      expect(JSON.parse(raw ?? '{}').claimed_source_keys).toContain('bombsquad:local-run')
    })
  })

  it('enables the public streak profile for existing account records without new local events', async () => {
    const fetchSpy = stubApi({
      session: AUTHED,
      arcadeProfile: {
        profile: ACCOUNT_ARCADE_PROFILE,
        public_profile: { claimed: false, public_label: null },
      },
    })
    renderAccount('/me')

    fireEvent.click(await screen.findByRole('button', { name: '启用公开上榜' }))

    await waitFor(() => {
      const claimCall = fetchSpy.mock.calls.find(([input]) =>
        urlOf(input as RequestInfo | URL).includes('/api/arcade/profile/claim')
      )
      expect(claimCall).toBeDefined()
      const [, init] = claimCall as unknown as [RequestInfo | URL, RequestInit]
      expect(JSON.parse(String(init.body))).toEqual({
        profile_id: 'local-profile',
        events: [],
      })
    })
  })

  it('shows the companion setup CTA when the user has no companion yet', async () => {
    stubApi({ session: AUTHED }) // companion defaults to 404 (none)
    renderAccount('/me')

    expect(await screen.findByRole('link', { name: '认识你的伙伴' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '认识你的伙伴' })).toHaveAttribute(
      'href',
      '/me/companion'
    )
  })

  it('shows "你的伙伴 X" with album + profile links when a companion exists', async () => {
    stubApi({
      session: AUTHED,
      companion: {
        status: 200,
        body: {
          name: '小南',
          address_style: '队长',
          voice_id: 'companion-warm',
          profile_enabled: true,
          created_at: '2026-05-30T09:12:00.000Z',
        },
      },
    })
    renderAccount('/me')

    expect(await screen.findByText('小南')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回忆相册' })).toHaveAttribute('href', '/me/memories')
    expect(screen.getByRole('link', { name: '画像控制面' })).toHaveAttribute('href', '/me/profile')
    // The voice is represented by name, not fabricated audio playback.
    expect(screen.getByText('暖声')).toBeInTheDocument()
  })

  it('keeps the companion intimate name out of the /me title/greeting (ruling A)', async () => {
    stubApi({
      session: AUTHED,
      companion: {
        status: 200,
        body: {
          name: '小南',
          address_style: '白舟',
          voice_id: 'companion-warm',
          profile_enabled: true,
          created_at: '2026-05-30T09:12:00.000Z',
        },
      },
    })
    renderAccount('/me')

    // Ruling A: with no chosen username, the /me greeting is NEUTRAL — the
    // companion-given intimate name 「白舟」(address_style) must NOT surface in
    // the title or the profile card (it belongs only to companion surfaces).
    // The email local-part「nova」is never a name fallback either (F19).
    expect(await screen.findByText('你的星轨。')).toBeInTheDocument()
    expect(screen.queryByText('白舟', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('nova', { exact: true })).not.toBeInTheDocument()
    // The companion card still names the companion itself (小南).
    expect(screen.getByText('小南')).toBeInTheDocument()
  })

  it('signs out via POST /api/auth/logout and returns to the anonymous state', async () => {
    const assignSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign: assignSpy })
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/companion')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'no companion set up' }), { status: 404 })
        )
      }
      if (url.includes('/api/auth/logout')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      }
      if (url.includes('/api/arcade/profile')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              profile: EMPTY_ARCADE_PROFILE,
              public_profile: { claimed: false, public_label: null },
            }),
            { status: 200 }
          )
        )
      }
      return Promise.resolve(new Response(JSON.stringify(AUTHED), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)
    renderAccount('/me')

    // The sign-out action lives on the signed-in profile card.
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }))

    // The whole UI is reset to anonymous via a hard navigation home, and the
    // sign-out POST hit /api/auth/logout.
    await vi.waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/'))
    const logoutCall = fetchSpy.mock.calls.find(([input]) =>
      urlOf(input as RequestInfo | URL).includes('/api/auth/logout')
    )
    expect(logoutCall).toBeDefined()
    const [, init] = logoutCall as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
  })
})
