import { describe, expect, it } from 'vitest'
import { FakeKV } from './fake-kv'
import { requireSession } from './require-session'

function requestWithCookie(cookie?: string): Request {
  return new Request('https://claw.amio.fans/api/companion/profile', {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  })
}

describe('requireSession', () => {
  it('rejects a request with no session cookie with 401', async () => {
    const kv = new FakeKV()
    const result = await requireSession(kv.asKV(), requestWithCookie())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect(result.response.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it('rejects a cookie pointing at no stored session (revoked / expired)', async () => {
    const kv = new FakeKV()
    const result = await requireSession(kv.asKV(), requestWithCookie('amiclaw_session=ghost'))
    expect(result.ok).toBe(false)
  })

  it('resolves the session identity from a valid cookie', async () => {
    const kv = new FakeKV()
    await kv.put(
      'session:sess-1',
      JSON.stringify({ user_id: 'user-a', email: 'a@example.com', created_at: '2026-06-11' })
    )
    const result = await requireSession(kv.asKV(), requestWithCookie('amiclaw_session=sess-1'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.session.user_id).toBe('user-a')
    }
  })
})
