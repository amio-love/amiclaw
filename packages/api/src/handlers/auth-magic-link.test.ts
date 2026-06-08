import { describe, expect, it, vi } from 'vitest'
import { FakeKV } from '../auth/fake-kv'
import type { EmailSender, MagicLinkEmail } from '../auth/email'
import type { AuthEnv } from '../auth/config'
import { MAGIC_LINK_TTL_SECONDS, VERIFY_GLOBAL_LIMIT } from '../auth/config'
import { handleMagicLinkRequest } from './auth-magic-link-request'
import { handleMagicLinkVerify } from './auth-magic-link-verify'
import { SESSION_COOKIE_NAME } from '../../../../shared/auth-types'
import { hashToken } from '../auth/crypto'
import { magicLinkKey } from '../auth/kv-keys'
import { checkVerifyGlobalLimit } from '../auth/rate-limit'

/** A capturing mock sender — tests never hit live email. */
function captureSender(): { sender: EmailSender; sent: MagicLinkEmail[] } {
  const sent: MagicLinkEmail[] = []
  const sender: EmailSender = vi.fn(async (email: MagicLinkEmail) => {
    sent.push(email)
    return { sent: true }
  })
  return { sender, sent }
}

function env(kv: FakeKV): AuthEnv {
  return { AUTH: kv.asKV(), AUTH_BASE_URL: 'https://claw.amio.fans' }
}

function requestBody(body: unknown): Request {
  return new Request('https://claw.amio.fans/api/auth/magic-link/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get('token') ?? ''
}

function verifyRequest(token: string): Request {
  const url = new URL('https://claw.amio.fans/api/auth/magic-link/verify')
  if (token) url.searchParams.set('token', token)
  return new Request(url.toString(), { method: 'GET' })
}

describe('magic-link request', () => {
  it('stores only the SHA-256 hash, never the plaintext token (invariant ②)', async () => {
    const kv = new FakeKV()
    const { sender, sent } = captureSender()
    await handleMagicLinkRequest(requestBody({ email: 'a@example.com' }), env(kv), sender)

    const magicKeys = kv.keysWithPrefix('magiclink:')
    expect(magicKeys).toHaveLength(1)
    // The stored key suffix is a 64-char hex SHA-256, not the plaintext token.
    const hashSuffix = magicKeys[0].slice('magiclink:'.length)
    expect(hashSuffix).toMatch(/^[0-9a-f]{64}$/)
    const token = tokenFromUrl(sent[0].verifyUrl)
    expect(hashSuffix).not.toBe(token)
    // No KV value anywhere contains the plaintext token.
    for (const entry of kv.store.values()) {
      expect(entry.value).not.toContain(token)
    }
  })

  it('writes the token hash with a TTL ≤ 15 minutes (invariant ①)', async () => {
    const kv = new FakeKV()
    const { sender } = captureSender()
    await handleMagicLinkRequest(requestBody({ email: 'a@example.com' }), env(kv), sender)
    const key = kv.keysWithPrefix('magiclink:')[0]
    expect(kv.ttlOf(key)).toBe(MAGIC_LINK_TTL_SECONDS)
    expect(kv.ttlOf(key)!).toBeLessThanOrEqual(15 * 60)
  })

  it('returns an identical unified response for unknown vs known email (invariant ④)', async () => {
    const kv = new FakeKV()
    const { sender } = captureSender()
    const r1 = await handleMagicLinkRequest(
      requestBody({ email: 'known@example.com' }),
      env(kv),
      sender
    )
    const r2 = await handleMagicLinkRequest(
      requestBody({ email: 'someone@example.com' }),
      env(kv),
      sender
    )
    expect(r1.status).toBe(r2.status)
    expect(await r1.clone().text()).toBe(await r2.clone().text())
  })

  it('returns the same unified response for a malformed email and sends nothing', async () => {
    const kv = new FakeKV()
    const { sender, sent } = captureSender()
    const good = await handleMagicLinkRequest(
      requestBody({ email: 'a@example.com' }),
      env(kv),
      sender
    )
    const bad = await handleMagicLinkRequest(
      requestBody({ email: 'not-an-email' }),
      env(kv),
      sender
    )
    expect(bad.status).toBe(good.status)
    expect(await bad.clone().text()).toBe(await good.clone().text())
    // Only the valid email triggered a send.
    expect(sent).toHaveLength(1)
  })

  it('does not send once the per-email cap is exceeded, but response is unchanged (invariants ③ + ④)', async () => {
    const kv = new FakeKV()
    const { sender, sent } = captureSender()
    let lastStatus = 0
    let lastBody = ''
    for (let i = 0; i < 7; i++) {
      const r = await handleMagicLinkRequest(
        requestBody({ email: 'a@example.com' }),
        env(kv),
        sender
      )
      lastStatus = r.status
      lastBody = await r.text()
    }
    expect(lastStatus).toBe(200)
    expect(lastBody).toContain('on its way')
    // Capped at the configured limit (5), not all 7.
    expect(sent.length).toBeLessThanOrEqual(5)
    expect(sent.length).toBeGreaterThan(0)
  })
})

describe('magic-link verify', () => {
  it('verifies, sets a Lax/HttpOnly/Secure cookie, and redirects (invariant ⑤)', async () => {
    const kv = new FakeKV()
    const { sender, sent } = captureSender()
    await handleMagicLinkRequest(requestBody({ email: 'a@example.com' }), env(kv), sender)
    const token = tokenFromUrl(sent[0].verifyUrl)

    const res = await handleMagicLinkVerify(verifyRequest(token), env(kv))
    expect(res.status).toBe(302)
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    // A session record now exists.
    expect(kv.keysWithPrefix('session:')).toHaveLength(1)
  })

  it('consumes the token single-use — a second verify fails (invariant ①)', async () => {
    const kv = new FakeKV()
    const { sender, sent } = captureSender()
    await handleMagicLinkRequest(requestBody({ email: 'a@example.com' }), env(kv), sender)
    const token = tokenFromUrl(sent[0].verifyUrl)

    const first = await handleMagicLinkVerify(verifyRequest(token), env(kv))
    expect(first.headers.get('Set-Cookie')).toBeTruthy()
    // Token key is gone.
    expect(kv.keysWithPrefix('magiclink:')).toHaveLength(0)

    const second = await handleMagicLinkVerify(verifyRequest(token), env(kv))
    expect(second.status).toBe(302)
    // No new session, and no cookie set on the failed second attempt.
    expect(second.headers.get('Set-Cookie')).toBeNull()
    expect(second.headers.get('Location')).toContain('/login')
    expect(kv.keysWithPrefix('session:')).toHaveLength(1)
  })

  it('redirects to login on an invalid / unknown token (no session set)', async () => {
    const kv = new FakeKV()
    const res = await handleMagicLinkVerify(verifyRequest('deadbeef'), env(kv))
    expect(res.status).toBe(302)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(res.headers.get('Location')).toContain('/login')
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
  })

  it('redirects to login when no token is supplied', async () => {
    const kv = new FakeKV()
    const res = await handleMagicLinkVerify(verifyRequest(''), env(kv))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login')
  })

  it('writes login + verify audit events (invariant ⑦)', async () => {
    const kv = new FakeKV()
    const { sender, sent } = captureSender()
    await handleMagicLinkRequest(requestBody({ email: 'a@example.com' }), env(kv), sender)
    const token = tokenFromUrl(sent[0].verifyUrl)
    await handleMagicLinkVerify(verifyRequest(token), env(kv))

    const audit = kv.keysWithPrefix('audit:')
    expect(audit.some((k) => k.startsWith('audit:login:'))).toBe(true)
    expect(audit.some((k) => k.startsWith('audit:magic_link_verify:'))).toBe(true)
  })

  it('yields the same user_id for the same email across two logins', async () => {
    const kv = new FakeKV()
    const { sender, sent } = captureSender()

    await handleMagicLinkRequest(requestBody({ email: 'stable@example.com' }), env(kv), sender)
    await handleMagicLinkVerify(verifyRequest(tokenFromUrl(sent[0].verifyUrl)), env(kv))
    await handleMagicLinkRequest(requestBody({ email: 'stable@example.com' }), env(kv), sender)
    await handleMagicLinkVerify(verifyRequest(tokenFromUrl(sent[1].verifyUrl)), env(kv))

    const sessions = kv.keysWithPrefix('session:')
    const records = await Promise.all(sessions.map((k) => kv.get(k, 'json')))
    const userIds = new Set(records.map((r) => (r as { user_id: string }).user_id))
    expect(userIds.size).toBe(1)
  })

  it('short-circuits on the global verify cap before any side effect (invariant ③)', async () => {
    const kv = new FakeKV()

    // Seed an OTHERWISE-VALID token: its `magiclink:<hash>` exists in KV, so
    // the only thing blocking verify is the rate limit.
    const token = 'a'.repeat(64)
    const tokenKey = magicLinkKey(await hashToken(token))
    await kv.put(tokenKey, JSON.stringify({ email: 'a@example.com' }))

    // Exhaust the global verify counter past its cap.
    for (let i = 0; i < VERIFY_GLOBAL_LIMIT; i++) {
      await checkVerifyGlobalLimit(kv.asKV())
    }

    const res = await handleMagicLinkVerify(verifyRequest(token), env(kv))

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=rate_limited')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    // The rate-limit branch must run before any consume / session create:
    // the token is still present and no session was created.
    expect(await kv.get(tokenKey, 'json')).not.toBeNull()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
  })
})
