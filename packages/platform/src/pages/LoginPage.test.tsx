/**
 * LoginPage (/login) integration tests.
 *
 * Two real sign-in paths:
 *   1. the form renders an email input and a submit button, AND a Google
 *      sign-in link to /api/auth/google/start (live now that the endpoint
 *      exists — a navigational <a>, not a fetch).
 *   2. submitting the email form POSTs to /api/auth/magic-link/request and shows
 *      the unified anti-enumeration confirmation — the same message regardless
 *      of whether the email is known (the page never reveals which addresses can
 *      sign in).
 *   3. a network failure surfaces a retry message, not the confirmation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from './LoginPage'

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>
  )
}

describe('LoginPage /login', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the email form and a live Google sign-in link', () => {
    renderLogin()

    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送登录邮件' })).toBeInTheDocument()

    // The Google option is a real navigational link to the start endpoint
    // (the browser follows the 302 to Google), not a fetch button.
    const google = screen.getByRole('link', { name: /Google/ })
    expect(google).toBeInTheDocument()
    expect(google).toHaveAttribute('href', expect.stringContaining('/api/auth/google/start'))
  })

  it('shows the unified confirmation after submitting an email', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, message: 'x' }), { status: 200 }))
    )
    vi.stubGlobal('fetch', fetchSpy)
    renderLogin()

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'nova@amio.fans' } })
    fireEvent.click(screen.getByRole('button', { name: '发送登录邮件' }))

    expect(await screen.findByText('如果该邮箱可用，你会收到一封登录邮件。')).toBeInTheDocument()
    // The POST hit the magic-link request endpoint with the typed email.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/auth/magic-link/request')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'nova@amio.fans' })
  })

  it('surfaces a retry message on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    )
    renderLogin()

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'nova@amio.fans' } })
    fireEvent.click(screen.getByRole('button', { name: '发送登录邮件' }))

    expect(await screen.findByText('发送失败，请检查网络后重试。')).toBeInTheDocument()
    // The unified confirmation must NOT appear on a true network failure.
    expect(screen.queryByText('如果该邮箱可用，你会收到一封登录邮件。')).not.toBeInTheDocument()
  })
})
