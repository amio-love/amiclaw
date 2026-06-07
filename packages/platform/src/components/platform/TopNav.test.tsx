/**
 * TopNav right-slot tests.
 *
 * The product is anonymous-by-design (roadmap: nickname + device fingerprint,
 * no login or registration), so the anonymous right-slot CTA must be a REAL
 * entry into play, not a dead auth placeholder:
 *   1. signed-out → the right slot shows an honest play-entry CTA with no
 *      login/registration wording
 *   2. clicking it enters the BombSquad SPA via
 *      window.location.assign('/bombsquad/') — the same cross-app entry every
 *      other play CTA uses (a client-side Link to "/" would no-op on the homepage)
 *   3. signed-in (?auth=in) → the avatar link to /me replaces the CTA
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TopNav from './TopNav'

// BombSquad lives in its own SPA at /bombsquad/, so the play CTA crosses the
// app boundary via window.location.assign. Spy on it to assert the target.
const assignSpy = vi.fn()

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

  it('shows an honest play-entry CTA for a signed-out visitor', () => {
    renderNav('/leaderboard')

    expect(screen.getByRole('button', { name: '开始玩' })).toBeInTheDocument()
    // The dead auth placeholder must be gone — no login/registration wording.
    expect(screen.queryByText('登录 / 开始')).not.toBeInTheDocument()
    expect(screen.queryByText(/登录|注册/)).not.toBeInTheDocument()
  })

  it('enters the BombSquad SPA when the play CTA is clicked', () => {
    renderNav('/leaderboard')

    fireEvent.click(screen.getByRole('button', { name: '开始玩' }))

    expect(assignSpy).toHaveBeenCalledWith('/bombsquad/')
  })

  it('shows the /me avatar link instead of the CTA for a signed-in visitor', () => {
    renderNav('/leaderboard?auth=in')

    expect(screen.getByLabelText('我的')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开始玩' })).not.toBeInTheDocument()
  })
})
