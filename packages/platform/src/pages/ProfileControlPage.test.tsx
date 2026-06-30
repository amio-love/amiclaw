/**
 * ProfileControlPage (/me/profile) integration tests — the four player-sovereign
 * operations.
 *
 *   1. claims render with their evidence chain (each evidence links back to the
 *      source episode in the album — the no-black-box invariant);
 *   2. an honest empty state when there are no claims;
 *   3. correction replaces the claim with the new wording;
 *   4. deleting one claim removes it;
 *   5. the profile switch flips and PUTs;
 *   6. "清空全部画像" clears every claim.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ProfileClaimView } from '@shared/companion-types'
import ProfileControlPage from './ProfileControlPage'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const AUTHED = { authenticated: true, identity: { user_id: 'u_1', email: 'nova@amio.fans' } }

const CLAIM: ProfileClaimView = {
  id: 'cl-1',
  dimension: '节奏偏好',
  claim: '你在压力下反而更专注。',
  status: 'active',
  updated_at: '2026-06-28T21:45:00.000Z',
  evidence: [
    {
      episode_id: 'ep-1',
      title: '最后三秒拆掉了炸弹',
      occurred_at: '2026-06-28T21:40:00.000Z',
      game_id: 'bombsquad',
    },
  ],
}

interface ServerOptions {
  profileEnabled?: boolean
  claims?: ProfileClaimView[]
}

function stubServer(options: ServerOptions = {}) {
  const profileEnabled = options.profileEnabled ?? true
  const claims = options.claims ?? [CLAIM]
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/api/auth/session')) return Promise.resolve(json(AUTHED))
      if (url.includes('/correction') && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { correction: string }
        const newClaim: ProfileClaimView = {
          ...CLAIM,
          id: 'cl-2',
          claim: body.correction,
        }
        return Promise.resolve(json({ corrected_claim_id: 'cl-1', new_claim: newClaim }))
      }
      if (url.match(/\/api\/companion\/profile\/[^/]+$/) && method === 'DELETE') {
        return Promise.resolve(json({ ok: true }))
      }
      if (url.endsWith('/api/companion/profile') && method === 'DELETE') {
        return Promise.resolve(json({ deleted: claims.length }))
      }
      if (url.endsWith('/api/companion/profile') && method === 'PUT') {
        return Promise.resolve(json({ profile_enabled: false }))
      }
      if (url.endsWith('/api/companion/profile')) {
        return Promise.resolve(json({ profile_enabled: profileEnabled, claims }))
      }
      return Promise.resolve(json({}, 404))
    })
  )
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/me/profile']}>
      <Routes>
        <Route path="/me/profile" element={<ProfileControlPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProfileControlPage /me/profile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a claim with its evidence chain linking back to the episode', async () => {
    stubServer()
    renderProfile()

    expect(await screen.findByText('你在压力下反而更专注。')).toBeInTheDocument()
    expect(screen.getByText('节奏偏好')).toBeInTheDocument()
    const evidence = screen.getByRole('link', { name: /最后三秒拆掉了炸弹/ })
    expect(evidence).toHaveAttribute('href', '/me/memories?focus=ep-1')
  })

  it('shows an honest empty state with no claims', async () => {
    stubServer({ claims: [] })
    renderProfile()

    expect(await screen.findByText('还没有形成任何理解')).toBeInTheDocument()
    expect(screen.queryByText(/即将推出/)).not.toBeInTheDocument()
  })

  it('replaces a claim with the corrected wording', async () => {
    const user = userEvent.setup()
    stubServer()
    renderProfile()

    await user.click(await screen.findByRole('button', { name: '纠正' }))
    const dialog = await screen.findByRole('dialog', { name: '纠正这条理解' })
    await user.type(within(dialog).getByLabelText('改成'), '你喜欢稳扎稳打。')
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await screen.findByText('你喜欢稳扎稳打。')).toBeInTheDocument()
    expect(screen.queryByText('你在压力下反而更专注。')).not.toBeInTheDocument()
  })

  it('deletes a single claim', async () => {
    stubServer()
    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    const dialog = await screen.findByRole('dialog', { name: '删除这条理解？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    expect(await screen.findByText('还没有形成任何理解')).toBeInTheDocument()
  })

  it('flips the profile switch', async () => {
    stubServer()
    renderProfile()

    const sw = await screen.findByRole('switch', { name: '画像开关' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    expect(await screen.findByText(/画像已关闭/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '画像开关' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('clears every claim via 清空全部画像', async () => {
    stubServer()
    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: '清空全部画像' }))
    const dialog = await screen.findByRole('dialog', { name: '清空全部画像？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '清空全部' }))

    expect(await screen.findByText('还没有形成任何理解')).toBeInTheDocument()
  })
})
