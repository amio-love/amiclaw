/**
 * CompanionOnboardingPage (/me/companion) integration tests.
 *
 * Drives the real API path (auth + companion fetches are route-mocked):
 *   1. a signed-in player with no companion sees the form, names + picks a
 *      voice, submits, and the identity is read back as "你的伙伴 X";
 *   2. a 409 (already created elsewhere) resolves gracefully to the existing
 *      identity, not an error;
 *   3. a player who already has a companion skips the form entirely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { CompanionIdentity } from '@shared/companion-types'
import { __resetCompanionStore } from '@/hooks/useCompanion'
import CompanionOnboardingPage from './CompanionOnboardingPage'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const AUTHED = { authenticated: true, identity: { user_id: 'u_1', email: 'nova@amio.fans' } }

interface ServerOptions {
  companion?: CompanionIdentity | null
  setupOutcome?: 'created' | 'conflict'
}

/** A stateful fetch mock: GET /api/companion reflects current state; POST setup
    creates (or 409s while still landing the existing identity, modelling a race
    resolved on reload). */
function stubServer(options: ServerOptions = {}) {
  let companion: CompanionIdentity | null = options.companion ?? null
  const outcome = options.setupOutcome ?? 'created'
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/api/auth/session')) return Promise.resolve(json(AUTHED))
      if (url.endsWith('/api/companion') && method === 'GET') {
        return Promise.resolve(companion ? json(companion) : json({ error: 'none' }, 404))
      }
      if (url.endsWith('/api/companion/setup') && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as {
          name: string
          voice_id: string
          address_style?: string
        }
        if (outcome === 'conflict') {
          companion = {
            name: '已存在',
            address_style: '',
            voice_id: 'companion-bright',
            profile_enabled: true,
            voice_posture: 'voice-default',
            created_at: '2026-06-01T00:00:00.000Z',
          }
          return Promise.resolve(json({ error: 'companion already exists' }, 409))
        }
        companion = {
          name: body.name,
          address_style: body.address_style ?? '',
          voice_id: body.voice_id,
          profile_enabled: true,
          voice_posture: 'voice-default',
          created_at: '2026-06-30T00:00:00.000Z',
        }
        return Promise.resolve(json({ companion }, 201))
      }
      return Promise.resolve(json({}, 404))
    })
  )
}

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={['/me/companion']}>
      <Routes>
        <Route path="/me/companion" element={<CompanionOnboardingPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('CompanionOnboardingPage /me/companion', () => {
  beforeEach(() => {
    __resetCompanionStore()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('names + voices a new companion and reads back "你的伙伴 X"', async () => {
    stubServer({ companion: null })
    renderOnboarding()

    fireEvent.change(await screen.findByLabelText('名字'), { target: { value: '小南' } })
    fireEvent.click(screen.getByRole('radio', { name: '暖声' }))
    fireEvent.click(screen.getByRole('button', { name: '认识你的伙伴' }))

    // Read back from GET /api/companion: the identity card with the name.
    expect(await screen.findByText('小南')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回忆相册' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '画像控制面' })).toBeInTheDocument()
    // The form is gone.
    expect(screen.queryByLabelText('名字')).not.toBeInTheDocument()
  })

  it('handles a 409 gracefully by showing the existing companion', async () => {
    stubServer({ companion: null, setupOutcome: 'conflict' })
    renderOnboarding()

    fireEvent.change(await screen.findByLabelText('名字'), { target: { value: '小南' } })
    fireEvent.click(screen.getByRole('radio', { name: '亮声' }))
    fireEvent.click(screen.getByRole('button', { name: '认识你的伙伴' }))

    expect(await screen.findByText('已存在')).toBeInTheDocument()
  })

  it('skips the form when a companion already exists', async () => {
    stubServer({
      companion: {
        name: '小南',
        address_style: '队长',
        voice_id: 'companion-warm',
        profile_enabled: true,
        voice_posture: 'voice-default',
        created_at: '2026-05-30T09:12:00.000Z',
      },
    })
    renderOnboarding()

    expect(await screen.findByText('小南')).toBeInTheDocument()
    expect(screen.queryByLabelText('名字')).not.toBeInTheDocument()
    // The chosen voice is represented by name (no fabricated audio audition).
    expect(screen.getByText('暖声')).toBeInTheDocument()
  })
})
