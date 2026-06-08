/**
 * TopNav right-slot tests.
 *
 * The right slot is driven by the real useAuth(), which reads
 * `GET /api/auth/session` asynchronously. The three states are:
 *   1. signed-out → a 登录 link to /login plus an honest 开始玩 play-entry CTA
 *      (no dead auth placeholder; mode① anonymous play is never forced)
 *   2. clicking 开始玩 enters the BombSquad SPA via
 *      window.location.assign('/bombsquad/') — the same cross-app entry every
 *      other play CTA uses
 *   3. signed-in → the avatar link to /me replaces the CTA
 *
 * Auth is the real session fetch: each test stubs global.fetch to return either
 * the anonymous or an authenticated session, then awaits the async resolution.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { SessionResponse } from '@shared/auth-types'
import TopNav from './TopNav'

// BombSquad lives in its own SPA at /bombsquad/, so the play CTA crosses the
// app boundary via window.location.assign. Spy on it to assert the target.
const assignSpy = vi.fn()

/** Stub GET /api/auth/session with a given session body. */
function stubSession(body: SessionResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })))
  )
}

const ANON: SessionResponse = { authenticated: false, identity: null }
const AUTHED: SessionResponse = {
  authenticated: true,
  identity: { user_id: 'u_1', email: 'nova@amio.fans' },
}

function renderNav(entry = '/leaderboard') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TopNav />
    </MemoryRouter>
  )
}

describe('TopNav right slot', () => {
  beforeEach(() => {
    assignSpy.mockClear()
    vi.stubGlobal('location', { ...window.location, assign: assignSpy })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a 登录 link and an honest play-entry CTA for a signed-out visitor', async () => {
    stubSession(ANON)
    renderNav('/leaderboard')

    // The play CTA resolves once the session read returns anonymous.
    expect(await screen.findByRole('button', { name: '开始玩' })).toBeInTheDocument()
    // A real 登录 entry to the magic-link page — not a dead placeholder.
    expect(screen.getByRole('link', { name: '登录' })).toBeInTheDocument()
  })

  it('enters the BombSquad SPA when the play CTA is clicked', async () => {
    stubSession(ANON)
    renderNav('/leaderboard')

    fireEvent.click(await screen.findByRole('button', { name: '开始玩' }))

    expect(assignSpy).toHaveBeenCalledWith('/bombsquad/')
  })

  it('shows the /me avatar link instead of the CTA for a signed-in visitor', async () => {
    stubSession(AUTHED)
    renderNav('/leaderboard')

    expect(await screen.findByLabelText('我的')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开始玩' })).not.toBeInTheDocument()
  })
})
