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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  /** When true, GET /api/companion/profile returns 404 (no companion yet). */
  noCompanion?: boolean
  proxySocialEnabled?: boolean
  /** GET /api/companion/proxy-social fails on the FIRST read, succeeds on retry. */
  proxySocialErrorOnce?: boolean
  /** PUT /api/companion/proxy-social fails (drives the optimistic-revert path). */
  proxySocialPutFails?: boolean
}

function stubServer(options: ServerOptions = {}) {
  const profileEnabled = options.profileEnabled ?? true
  const claims = options.claims ?? [CLAIM]
  const proxySocialEnabled = options.proxySocialEnabled ?? true
  let proxyGetCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/api/auth/session')) return Promise.resolve(json(AUTHED))
      if (url.endsWith('/api/companion/proxy-social') && method === 'PUT') {
        if (options.proxySocialPutFails) return Promise.resolve(json({}, 500))
        const body = JSON.parse(String(init?.body)) as { proxy_social_enabled: boolean }
        return Promise.resolve(json({ proxy_social_enabled: body.proxy_social_enabled }))
      }
      if (url.endsWith('/api/companion/proxy-social')) {
        if (options.noCompanion) {
          return Promise.resolve(json({ error: 'no companion set up' }, 404))
        }
        proxyGetCalls += 1
        if (options.proxySocialErrorOnce && proxyGetCalls === 1) {
          return Promise.resolve(json({ error: 'read failed' }, 500))
        }
        return Promise.resolve(json({ proxy_social_enabled: proxySocialEnabled }))
      }
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
        if (options.noCompanion) {
          return Promise.resolve(json({ error: 'no companion set up' }, 404))
        }
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

  it('shows an honest empty state when the companion has no claims yet', async () => {
    stubServer({ claims: [] })
    renderProfile()

    expect(await screen.findByText('还没有形成任何理解')).toBeInTheDocument()
    expect(screen.queryByText(/即将推出/)).not.toBeInTheDocument()
    // This is the has-companion case, so the profile switch IS present.
    expect(screen.getByRole('switch', { name: '画像开关' })).toBeInTheDocument()
  })

  it('gates to companion setup (not the toggle) when there is no companion', async () => {
    stubServer({ noCompanion: true })
    renderProfile()

    const cta = await screen.findByRole('link', { name: '认识你的伙伴' })
    expect(cta).toHaveAttribute('href', '/me/companion')
    // No profile to control: the switch and the empty-claims state must NOT show.
    expect(screen.queryByRole('switch', { name: '画像开关' })).not.toBeInTheDocument()
    expect(screen.queryByText('还没有形成任何理解')).not.toBeInTheDocument()
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

  it('flips the 代言社交 switch (甲侧代言总开关)', async () => {
    stubServer()
    renderProfile()

    const sw = await screen.findByRole('switch', { name: '代言社交开关' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('让伙伴替我在社区留言')).toBeInTheDocument()
    fireEvent.click(sw)
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '代言社交开关' })).toHaveAttribute(
        'aria-checked',
        'false'
      )
    )
  })

  it('starts the 代言社交 switch off when the server says it is disabled', async () => {
    stubServer({ proxySocialEnabled: false })
    renderProfile()

    const sw = await screen.findByRole('switch', { name: '代言社交开关' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('disables the 代言社交 switch and offers a retry when the read fails, then recovers', async () => {
    stubServer({ proxySocialErrorOnce: true })
    renderProfile()

    // Read failed → the switch must NOT silently render enabled: it is disabled
    // and an explicit retry is offered.
    const sw = await screen.findByRole('switch', { name: '代言社交开关' })
    expect(sw).toBeDisabled()
    expect(screen.getByText('开关状态暂时读不出来。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '代言社交开关' })).toBeEnabled())
    expect(screen.getByRole('switch', { name: '代言社交开关' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('reverts the 代言社交 switch to its prior state when the PUT fails', async () => {
    stubServer({ proxySocialPutFails: true })
    renderProfile()

    const sw = await screen.findByRole('switch', { name: '代言社交开关' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    // Optimistic flip to off…
    expect(screen.getByRole('switch', { name: '代言社交开关' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    // …then the failed PUT reverts it back to on.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '代言社交开关' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
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
