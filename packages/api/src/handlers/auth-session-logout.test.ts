import { describe, expect, it } from 'vitest'
import { FakeKV } from '../auth/fake-kv'
import type { AuthEnv } from '../auth/config'
import { createSession, buildSessionCookie } from '../auth/session'
import { handleGetSession } from './auth-session'
import { handleLogout } from './auth-logout'
import { SESSION_COOKIE_NAME } from '../../../../shared/auth-types'
import type { SessionResponse } from '../../../../shared/auth-types'

function env(kv: FakeKV): AuthEnv {
  return { AUTH: kv.asKV() }
}

function withCookie(method: string, sessionId?: string): Request {
  return new Request('https://claw.amio.fans/api/auth/session', {
    method,
    headers: sessionId ? { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } : {},
  })
}

describe('GET /api/auth/session', () => {
  it('returns the anonymous state with no cookie (200, not 401)', async () => {
    const kv = new FakeKV()
    const res = await handleGetSession(withCookie('GET'), env(kv))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SessionResponse
    expect(body).toEqual({ authenticated: false, identity: null })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns the identity for a valid session', async () => {
    const kv = new FakeKV()
    const { sessionId } = await createSession(kv.asKV(), {
      user_id: 'uid-9',
      email: 'p@example.com',
    })
    const res = await handleGetSession(withCookie('GET', sessionId), env(kv))
    const body = (await res.json()) as SessionResponse
    expect(body.authenticated).toBe(true)
    expect(body.identity).toEqual({ user_id: 'uid-9', email: 'p@example.com' })
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the server-side session and clears the cookie (invariant ⑦)', async () => {
    const kv = new FakeKV()
    const { sessionId } = await createSession(kv.asKV(), {
      user_id: 'uid-9',
      email: 'p@example.com',
    })
    const cookie = buildSessionCookie(sessionId).split(';')[0].split('=')[1]

    const res = await handleLogout(withCookie('POST', cookie), env(kv))
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
    // Server-side record is gone — the session is unusable afterwards.
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
    // Logout audit recorded.
    expect(kv.keysWithPrefix('audit:logout:')).toHaveLength(1)
  })

  it('is idempotent — logging out with no session still returns ok', async () => {
    const kv = new FakeKV()
    const res = await handleLogout(withCookie('POST'), env(kv))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })
})
