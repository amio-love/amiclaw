/**
 * CompanionDock — the bottom presence HOST.
 *
 * Covers only the host's routing: anonymous → nothing; the logged-in home
 * elevates the presence to the top so the dock stands down to a clearance
 * spacer (no second mounted presence); non-home renders the restrained
 * `in-game` strip for a companion, or the `create` entry without one.
 *
 * The presence CHILD is stubbed here — its states / voice behaviour are pinned
 * in CompanionPresence.test.tsx and CompanionPresence.lobby-voice.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CompanionIdentity } from '@shared/companion-types'

const authState = vi.hoisted(() => ({
  current: { status: 'anon', user: null } as { status: string; user: unknown },
}))
const companionState = vi.hoisted(() => ({
  current: { status: 'loading', companion: null } as {
    status: string
    companion: CompanionIdentity | null
    stats?: unknown
  },
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState.current, logout: async () => {} }),
}))
vi.mock('@/hooks/useCompanion', () => ({
  useCompanion: () => ({ state: companionState.current, reload: () => {} }),
}))
vi.mock('./CompanionPresence', () => ({
  default: ({ context, companion }: { context: string; companion?: CompanionIdentity }) => (
    <div data-testid="presence" data-context={context} data-companion={companion?.name ?? ''} />
  ),
}))

import CompanionDock from './CompanionDock'

const COMPANION: CompanionIdentity = {
  name: '阿澈',
  address_style: '',
  voice_id: 'companion-warm',
  profile_enabled: true,
  voice_posture: 'voice-default',
  created_at: '2026-06-30T00:00:00.000Z',
}

function signIn(state: { status: string; companion: CompanionIdentity | null }) {
  authState.current = { status: 'authed', user: { user_id: 'u1', email: 'a@b.c' } }
  companionState.current = state
}

function renderDock(path = '/leaderboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompanionDock />
    </MemoryRouter>
  )
}

describe('CompanionDock (host)', () => {
  beforeEach(() => {
    authState.current = { status: 'anon', user: null }
    companionState.current = { status: 'loading', companion: null }
  })

  it('renders nothing for an anonymous visitor', () => {
    renderDock('/leaderboard')
    expect(screen.queryByTestId('presence')).not.toBeInTheDocument()
  })

  it('stands down to a clearance spacer on the home route (presence elevated to the top)', () => {
    signIn({ status: 'exists', companion: COMPANION })
    const { container } = renderDock('/')
    // No presence strip here — the home hosts the shell presence at the top.
    expect(screen.queryByTestId('presence')).not.toBeInTheDocument()
    // A spacer remains so content still clears the fixed BottomNav.
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })

  it('renders the restrained in-game strip for a companion on a non-home page', () => {
    signIn({ status: 'exists', companion: COMPANION })
    renderDock('/community')
    const presence = screen.getByTestId('presence')
    expect(presence).toHaveAttribute('data-context', 'in-game')
    expect(presence).toHaveAttribute('data-companion', '阿澈')
  })

  it('renders the create entry for a signed-in player without a companion (non-home)', () => {
    signIn({ status: 'none', companion: null })
    renderDock('/me')
    expect(screen.getByTestId('presence')).toHaveAttribute('data-context', 'create')
  })

  it('renders nothing on an identity read error', () => {
    signIn({ status: 'error', companion: null })
    renderDock('/leaderboard')
    expect(screen.queryByTestId('presence')).not.toBeInTheDocument()
  })
})
