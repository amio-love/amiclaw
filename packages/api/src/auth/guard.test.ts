import { describe, expect, it } from 'vitest'
import { FakeKV } from './fake-kv'
import { decideGuard, guardClaimedUserId } from './guard'
import { createSession, buildSessionCookie } from './session'
import { SESSION_COOKIE_NAME } from '../../../../shared/auth-types'

const SESSION = { user_id: 'uid-1', email: 'a@example.com', created_at: '2026-06-08T00:00:00Z' }

describe('decideGuard (pure)', () => {
  it('allows when no user_id is claimed — anonymous flow is a no-op', () => {
    expect(decideGuard(null, null)).toEqual({ ok: true, identity: null })
    expect(decideGuard(undefined, null)).toEqual({ ok: true, identity: null })
    expect(decideGuard('', null)).toEqual({ ok: true, identity: null })
  })

  it('rejects a claimed user_id with no session', () => {
    const r = decideGuard('uid-1', null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(401)
  })

  it('rejects a claim that mismatches the session user', () => {
    const r = decideGuard('uid-OTHER', SESSION)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(401)
  })

  it('allows a claim that matches the session user', () => {
    const r = decideGuard('uid-1', SESSION)
    expect(r.ok).toBe(true)
  })
})

describe('guardClaimedUserId (cookie → session)', () => {
  function requestWithCookie(cookie?: string): Request {
    return new Request('https://claw.amio.fans/api/leaderboard', {
      method: 'POST',
      headers: cookie ? { Cookie: cookie } : {},
    })
  }

  it('allows a claim-less request even with no cookie', async () => {
    const kv = new FakeKV()
    const r = await guardClaimedUserId(kv.asKV(), requestWithCookie(), null)
    expect(r.ok).toBe(true)
  })

  it('rejects a forged user_id (no session cookie)', async () => {
    const kv = new FakeKV()
    const r = await guardClaimedUserId(kv.asKV(), requestWithCookie(), 'uid-1')
    expect(r.ok).toBe(false)
  })

  it('allows a claim backed by a real session', async () => {
    const kv = new FakeKV()
    const { sessionId } = await createSession(kv.asKV(), {
      user_id: 'uid-1',
      email: 'a@example.com',
    })
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`
    const r = await guardClaimedUserId(kv.asKV(), requestWithCookie(cookie), 'uid-1')
    expect(r.ok).toBe(true)
  })

  it('rejects a claim when the session belongs to a different user', async () => {
    const kv = new FakeKV()
    const { sessionId } = await createSession(kv.asKV(), {
      user_id: 'uid-1',
      email: 'a@example.com',
    })
    const cookie = buildSessionCookie(sessionId).split(';')[0]
    const r = await guardClaimedUserId(kv.asKV(), requestWithCookie(cookie), 'uid-IMPOSTER')
    expect(r.ok).toBe(false)
  })
})
