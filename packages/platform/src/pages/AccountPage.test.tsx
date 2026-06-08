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
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { SessionResponse } from '@shared/auth-types'
import AccountPage from './AccountPage'

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
  beforeEach(() => {
    // Section eyebrow is shown in every state; identity drives the body.
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the login guide and no fake profile for a signed-out visitor', async () => {
    stubSession(ANON)
    renderAccount('/me')

    // Login-guide markers: the heading and the plain-text unlock preview.
    expect(await screen.findByText('登录后查看你的星轨')).toBeInTheDocument()
    expect(screen.getByText('战绩与单局完成率')).toBeInTheDocument()
    expect(screen.getByText('连胜与最快记录')).toBeInTheDocument()
    expect(screen.getByText('勋章墙')).toBeInTheDocument()
    // A functional CTA linking to /login.
    expect(screen.getByRole('link', { name: '登录' })).toBeInTheDocument()

    // None of the retired mock-profile content may render for anyone now.
    expect(screen.queryByText('星海')).not.toBeInTheDocument()
    expect(screen.queryByText('林星海')).not.toBeInTheDocument()
    expect(screen.queryByText('42')).not.toBeInTheDocument()
    expect(screen.queryByText('最近 5 局')).not.toBeInTheDocument()
    expect(screen.queryByText('勋章', { exact: true })).not.toBeInTheDocument()
  })

  it('navigates to /login when the signed-out CTA is clicked', async () => {
    stubSession(ANON)
    renderAccount('/me')

    fireEvent.click(await screen.findByRole('link', { name: '登录' }))

    expect(screen.getByText('LOGIN PROBE')).toBeInTheDocument()
  })

  it('renders the real-identity profile with an honest empty stats state', async () => {
    stubSession(AUTHED)
    renderAccount('/me')

    // Identity is derived from the session email local-part (nova@... → nova).
    // The name appears twice (the title accent span + the profile-card name),
    // so assert at least one match resolves once the session read returns.
    expect((await screen.findAllByText('nova', { exact: true })).length).toBeGreaterThan(0)
    expect(screen.getByText('nova@amio.fans')).toBeInTheDocument()
    // Honest empty stats state — no fake numbers, no「即将推出」placeholder.
    expect(screen.getByText('还没有成绩，去玩一局。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '开始玩' })).toBeInTheDocument()
    // The retired mock stats / runs / badges must be absent.
    expect(screen.queryByText('林星海')).not.toBeInTheDocument()
    expect(screen.queryByText('42')).not.toBeInTheDocument()
    expect(screen.queryByText('最近 5 局')).not.toBeInTheDocument()
    // The login-guide empty state must NOT be present.
    expect(screen.queryByText('登录后查看你的星轨')).not.toBeInTheDocument()
  })
})
