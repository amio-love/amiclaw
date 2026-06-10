/**
 * TopNav right-slot tests.
 *
 * The right slot is driven by the real useAuth(), which reads
 * `GET /api/auth/session` asynchronously. The three states are:
 *   1. signed-out → a single primary 登录 / 注册 entry to /login, and NO play
 *      CTA in the nav (anonymous mode① play is reached from the homepage, so
 *      login is never forced and the nav is not a login wall)
 *   2. signed-in → the avatar link to /me replaces the auth entry
 *   3. loading → the slot is held neutral (no flash)
 *
 * Auth is the real session fetch: each test stubs global.fetch to return either
 * the anonymous or an authenticated session, then awaits the async resolution.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { SessionResponse } from '@shared/auth-types'
import TopNav from './TopNav'

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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a single 登录 / 注册 entry to /login for a signed-out visitor', async () => {
    stubSession(ANON)
    renderNav('/leaderboard')

    // The auth entry resolves once the session read returns anonymous.
    const authEntry = await screen.findByRole('link', { name: '登录 / 注册' })
    expect(authEntry).toHaveAttribute('href', '/login')
    // The nav is not a play surface — no 开始玩 CTA here. Anonymous play lives
    // on the homepage hero / BombSquad card, so this is not a login wall.
    expect(screen.queryByRole('button', { name: '开始玩' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '开始玩' })).not.toBeInTheDocument()
  })

  it('shows the /me avatar link instead of the auth entry for a signed-in visitor', async () => {
    stubSession(AUTHED)
    renderNav('/leaderboard')

    expect(await screen.findByLabelText('我的')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '登录 / 注册' })).not.toBeInTheDocument()
  })
})
