/**
 * LoginPage (/login) integration tests.
 *
 * The page is an honest fork, not a wall:
 *   0. it frames WHY an account exists (the platform-AI path / mode②) and states
 *      that playing with your own AI needs no login, and offers a direct-play
 *      escape into free anonymous play (window.location.assign('/bombsquad/')).
 *   1. it keeps two real sign-in paths: the email form (input + submit button)
 *      AND a Google sign-in link to /api/auth/google/start (live now that the
 *      endpoint exists — a navigational <a>, not a fetch).
 *   2. submitting the email form POSTs to /api/auth/magic-link/request and shows
 *      the unified anti-enumeration confirmation — the same message regardless
 *      of whether the email is known (the page never reveals which addresses can
 *      sign in).
 *   3. a network failure surfaces a retry message, not the confirmation.
 *   4. an already-authenticated visitor sees their identity and the continue /
 *      sign-out actions instead of the bare form; signing out POSTs
 *      /api/auth/logout and returns the site to the anonymous state.
 *   5. a failed verify / OAuth round-trip lands on /login?error=<value> and the
 *      page renders a clear Chinese explanation for every backend error value
 *      (plus an honest fallback), keeping the form ready below it.
 *   6. the post-send state echoes the typed email, states the real 15-minute
 *      validity and the spam-folder hint, and offers a cooldown-gated resend
 *      that honestly states the backend's 5-per-hour cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { SessionResponse } from '@shared/auth-types'
import LoginPage from './LoginPage'

/** Resolve any fetch input to its URL string. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url
}

const ANON: SessionResponse = { authenticated: false, identity: null }
const AUTHED: SessionResponse = {
  authenticated: true,
  identity: { user_id: 'u_1', email: 'nova@amio.fans' },
}

/** Stub GET /api/auth/session (read by useAuth on mount) with a given body. */
function stubSession(session: SessionResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(session), { status: 200 })))
  )
}

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
    </MemoryRouter>
  )
}

describe('LoginPage /login', () => {
  beforeEach(() => {
    // useAuth reads GET /api/auth/session on mount. Default to anonymous so the
    // sign-in form renders; tests needing a session or POST override this stub.
    stubSession(ANON)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('states the value of an account and that playing needs no account', () => {
    renderLogin()

    // Playing does NOT require login — the free anonymous mode① line, now a
    // tight one-liner paired with the inline direct-play escape.
    expect(screen.getByText(/玩游戏不需要登录/)).toBeInTheDocument()
    // The value-prop: an account delivers three things that are real today —
    // the platform AI companion, a real-activity community feed, and
    // cross-device progress. States current value, no「社交主场」overclaim and
    // no aspirational「你将拥有」framing (B6 copy-honesty sweep).
    const value = screen.getByText(/登录后，你会有专属于你的 AI 伙伴/)
    expect(value).toBeInTheDocument()
    expect(value.textContent).toContain('社区')
    expect(value.textContent).toContain('跨设备同步')
    expect(screen.queryByText(/社交主场/)).not.toBeInTheDocument()
  })

  it('offers a direct-play escape into free anonymous play', () => {
    const assignSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign: assignSpy })
    renderLogin()

    const directPlay = screen.getByRole('button', { name: '带自己的 AI 直接开始玩' })
    expect(directPlay).toBeInTheDocument()

    fireEvent.click(directPlay)
    // Full-page navigation into the BombSquad SPA (mode① BYO-AI play entry).
    expect(assignSpy).toHaveBeenCalledWith('/bombsquad/')
  })

  it('renders the email form and a live Google sign-in link', () => {
    renderLogin()

    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送登录链接' })).toBeInTheDocument()

    // The Google option is a real navigational link to the start endpoint
    // (the browser follows the 302 to Google), not a fetch button.
    const google = screen.getByRole('link', { name: /Google/ })
    expect(google).toBeInTheDocument()
    expect(google).toHaveAttribute('href', expect.stringContaining('/api/auth/google/start'))
  })

  it('shows the unified confirmation after submitting an email', async () => {
    // useAuth reads the session (anonymous here); the form submit POSTs the
    // magic-link request. One URL-aware spy answers both.
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (urlOf(input).includes('/api/auth/session')) {
        return Promise.resolve(new Response(JSON.stringify(ANON), { status: 200 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, message: 'x' }), { status: 200 })
      )
    })
    vi.stubGlobal('fetch', fetchSpy)
    renderLogin()

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'nova@amio.fans' } })
    fireEvent.click(screen.getByRole('button', { name: '发送登录链接' }))

    expect(await screen.findByText('如果该邮箱可用，你会收到一封登录邮件。')).toBeInTheDocument()
    // The POST hit the magic-link request endpoint exactly once, with the email.
    const magicCalls = fetchSpy.mock.calls.filter(([input]) =>
      urlOf(input as RequestInfo | URL).includes('/api/auth/magic-link/request')
    )
    expect(magicCalls).toHaveLength(1)
    const [, init] = magicCalls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ email: 'nova@amio.fans' })
  })

  it('renders a clear error state for an expired or used magic link (?error=invalid)', () => {
    renderLogin('/login?error=invalid')

    // What happened + what to do, in one honest banner.
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('登录链接已失效或已被使用')
    expect(alert.textContent).toContain('15 分钟')
    expect(alert.textContent).toContain('重新输入邮箱')
    // The form stays ready right below the explanation.
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送登录链接' })).toBeInTheDocument()
  })

  it('renders a distinct message for every backend error value, with an honest fallback', () => {
    // The full enum the auth backend 302s to /login with: magic-link verify
    // (invalid / rate_limited), Google start (google_unavailable) and callback
    // (google_denied / invalid_state / google_failed / email_unverified).
    const cases: Array<[string, RegExp]> = [
      ['rate_limited', /过于频繁/],
      ['google_unavailable', /Google 登录暂未开放/],
      ['google_denied', /Google 登录已取消/],
      ['invalid_state', /会话已过期/],
      ['google_failed', /Google 登录没有完成/],
      ['email_unverified', /尚未通过 Google 验证/],
      // Unknown future values still get an explanation, never a silent form.
      ['some_future_error', /登录没有完成/],
    ]
    for (const [error, expected] of cases) {
      const { unmount } = renderLogin(`/login?error=${error}`)
      expect(screen.getByRole('alert').textContent).toMatch(expected)
      unmount()
    }
  })

  it('shows no error banner without the error param', () => {
    renderLogin()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('after sending: echoes the email, states validity + spam hints, and gates resend on a cooldown', async () => {
    vi.useFakeTimers()
    try {
      const fetchSpy = vi.fn((input: RequestInfo | URL) => {
        if (urlOf(input).includes('/api/auth/session')) {
          return Promise.resolve(new Response(JSON.stringify(ANON), { status: 200 }))
        }
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, message: 'x' }), { status: 200 })
        )
      })
      vi.stubGlobal('fetch', fetchSpy)
      renderLogin()

      fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'nova@amio.fans' } })
      fireEvent.click(screen.getByRole('button', { name: '发送登录链接' }))
      await act(async () => {})

      // Unified confirmation + the player's own typed address echoed back.
      expect(screen.getByText('如果该邮箱可用，你会收到一封登录邮件。')).toBeInTheDocument()
      expect(screen.getByText('nova@amio.fans')).toBeInTheDocument()
      // Real validity period (shared/auth-types SSOT) + spam-folder hint.
      expect(screen.getByText(/15 分钟内有效/)).toBeInTheDocument()
      expect(screen.getByText(/垃圾邮件/)).toBeInTheDocument()
      // Honest rate-limit note mirroring the backend's real per-hour cap.
      expect(screen.getByText(/最多发送 5 封/)).toBeInTheDocument()

      // Resend is cooldown-gated: disabled with a countdown, then enabled.
      expect(screen.getByRole('button', { name: /重新发送（60 秒后可用）/ })).toBeDisabled()
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          vi.advanceTimersByTime(1000)
        })
      }
      const resend = screen.getByRole('button', { name: '重新发送登录邮件' })
      expect(resend).toBeEnabled()

      // A resend fires a second POST and re-arms the cooldown in place — the
      // sent panel never flips back to the form.
      fireEvent.click(resend)
      await act(async () => {})
      const magicCalls = fetchSpy.mock.calls.filter(([input]) =>
        urlOf(input as RequestInfo | URL).includes('/api/auth/magic-link/request')
      )
      expect(magicCalls).toHaveLength(2)
      expect(screen.getByRole('button', { name: /重新发送（60 秒后可用）/ })).toBeDisabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers a way back to the form to fix a typoed address', async () => {
    renderLogin()

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'nova@amio.fans' } })
    fireEvent.click(screen.getByRole('button', { name: '发送登录链接' }))

    fireEvent.click(await screen.findByRole('button', { name: '换一个邮箱' }))
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
  })

  it('surfaces a retry message on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    )
    renderLogin()

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'nova@amio.fans' } })
    fireEvent.click(screen.getByRole('button', { name: '发送登录链接' }))

    expect(await screen.findByText('发送失败，请检查网络后重试。')).toBeInTheDocument()
    // The unified confirmation must NOT appear on a true network failure.
    expect(screen.queryByText('如果该邮箱可用，你会收到一封登录邮件。')).not.toBeInTheDocument()
  })

  it('shows the signed-in identity and continue / sign-out actions, not the form', async () => {
    stubSession(AUTHED)
    renderLogin()

    // Identity: the session email, with continue + sign-out actions.
    expect(await screen.findByText('nova@amio.fans')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument()
    // The bare sign-in form must NOT render for an already-authenticated visitor.
    expect(screen.queryByLabelText('邮箱')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发送登录链接' })).not.toBeInTheDocument()
  })

  it('signs out via POST /api/auth/logout and returns to the anonymous state', async () => {
    const assignSpy = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign: assignSpy })
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (urlOf(input).includes('/api/auth/logout')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(AUTHED), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchSpy)
    renderLogin()

    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }))

    // The sign-out POST hit /api/auth/logout, and the whole UI is reset to
    // anonymous via a hard navigation home.
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
