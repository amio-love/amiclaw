import { describe, expect, it } from 'vitest'
import { FakeKV } from './fake-kv'
import { SESSION_COOKIE_NAME } from '../../../../shared/auth-types'
import { SESSION_TTL_SECONDS } from './config'
import {
  createSession,
  readSession,
  revokeSession,
  readSessionCookie,
  readSessionFromRequest,
  buildSessionCookie,
  buildClearedSessionCookie,
} from './session'

const IDENTITY = { user_id: 'uid-123', email: 'player@example.com' }

function requestWithCookie(cookie: string): Request {
  return new Request('https://claw.amio.fans/api/auth/session', {
    headers: { Cookie: cookie },
  })
}

describe('auth session', () => {
  it('creates, reads, and revokes a session (invariant ⑦ revocable)', async () => {
    const kv = new FakeKV()
    const { sessionId, record } = await createSession(kv.asKV(), IDENTITY)
    expect(record.user_id).toBe('uid-123')

    const read = await readSession(kv.asKV(), sessionId)
    expect(read?.email).toBe('player@example.com')

    await revokeSession(kv.asKV(), sessionId)
    expect(await readSession(kv.asKV(), sessionId)).toBeNull()
  })

  it('writes the session with the configured TTL', async () => {
    const kv = new FakeKV()
    const { sessionId } = await createSession(kv.asKV(), IDENTITY)
    expect(kv.ttlOf(`session:${sessionId}`)).toBe(SESSION_TTL_SECONDS)
  })

  it('parses the session id out of the Cookie header', () => {
    const req = requestWithCookie(`other=x; ${SESSION_COOKIE_NAME}=abc123; more=y`)
    expect(readSessionCookie(req)).toBe('abc123')
  })

  it('returns null when no cookie present', () => {
    const req = new Request('https://claw.amio.fans/api/auth/session')
    expect(readSessionCookie(req)).toBeNull()
  })

  it('readSessionFromRequest round-trips a real cookie', async () => {
    const kv = new FakeKV()
    const { sessionId } = await createSession(kv.asKV(), IDENTITY)
    const req = requestWithCookie(buildSessionCookie(sessionId).split(';')[0])
    const session = await readSessionFromRequest(kv.asKV(), req)
    expect(session?.user_id).toBe('uid-123')
  })

  it('cookie is HttpOnly + Secure + SameSite=Lax (invariant ⑤)', () => {
    const cookie = buildSessionCookie('sid')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
  })

  it('cleared cookie expires immediately', () => {
    const cookie = buildClearedSessionCookie()
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })
})
