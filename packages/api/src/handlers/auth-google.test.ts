import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeKV } from '../auth/fake-kv'
import type { AuthEnv } from '../auth/config'
import { OAUTH_STATE_TTL_SECONDS } from '../auth/config'
import { handleGoogleStart } from './auth-google-start'
import { handleGoogleCallback } from './auth-google-callback'
import { handleMagicLinkRequest } from './auth-magic-link-request'
import { handleMagicLinkVerify } from './auth-magic-link-verify'
import type { GoogleTokenExchanger, GoogleIdentity } from '../auth/google-oauth'
import {
  decodeGoogleIdToken,
  createGoogleTokenExchanger,
  OAUTH_STATE_COOKIE_NAME,
} from '../auth/google-oauth'
import type { EmailSender, MagicLinkEmail } from '../auth/email'
import { SESSION_COOKIE_NAME } from '../../../../shared/auth-types'
import { deriveUserId } from '../auth/identity'

const CONFIGURED: Partial<AuthEnv> = {
  AUTH_BASE_URL: 'https://claw.amio.fans',
  GOOGLE_OAUTH_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
}

function env(kv: FakeKV, overrides: Partial<AuthEnv> = CONFIGURED): AuthEnv {
  return { AUTH: kv.asKV(), ...overrides }
}

/** A mock exchanger — tests never hit live Google. */
function mockExchanger(identity: GoogleIdentity): GoogleTokenExchanger {
  return vi.fn(async () => ({ ok: true, identity }))
}

/**
 * Build a callback request. By default the `oauth_state` cookie is set to match
 * the `state` query param (the normal browser case — start planted that cookie).
 * `cookie` overrides this: `null` omits the cookie entirely (browser-binding
 * failure), a string forces a specific cookie value (mismatch case).
 */
function callbackRequest(params: Record<string, string>, cookie?: string | null): Request {
  const url = new URL('https://claw.amio.fans/api/auth/google/callback')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  const cookieValue = cookie === undefined ? params.state : cookie
  if (cookieValue) headers.Cookie = `${OAUTH_STATE_COOKIE_NAME}=${cookieValue}`
  return new Request(url.toString(), { method: 'GET', headers })
}

/** Run start, then pull the `state` back out of the KV record it wrote. */
async function startAndGetState(kv: FakeKV): Promise<string> {
  const res = await handleGoogleStart(env(kv))
  expect(res.status).toBe(302)
  const stateKeys = kv.keysWithPrefix('oauth_state:')
  expect(stateKeys).toHaveLength(1)
  return stateKeys[0].slice('oauth_state:'.length)
}

describe('GET /api/auth/google/start', () => {
  it('stores a single-use state and redirects to Google with the OAuth params (invariant ⑥)', async () => {
    const kv = new FakeKV()
    const res = await handleGoogleStart(env(kv))

    expect(res.status).toBe(302)
    const location = res.headers.get('Location') ?? ''
    const url = new URL(location)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe(CONFIGURED.GOOGLE_OAUTH_CLIENT_ID)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid email')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://claw.amio.fans/api/auth/google/callback'
    )

    // The state in the URL is the same one written to KV (CSRF token).
    const stateInUrl = url.searchParams.get('state') ?? ''
    expect(stateInUrl).toMatch(/^[0-9a-f]{64}$/)
    expect(kv.keysWithPrefix('oauth_state:')).toEqual([`oauth_state:${stateInUrl}`])
  })

  it('writes the state with the short TTL', async () => {
    const kv = new FakeKV()
    await handleGoogleStart(env(kv))
    const key = kv.keysWithPrefix('oauth_state:')[0]
    expect(kv.ttlOf(key)).toBe(OAUTH_STATE_TTL_SECONDS)
    expect(kv.ttlOf(key)!).toBeLessThanOrEqual(10 * 60)
  })

  it('sets the oauth_state binding cookie (HttpOnly+Secure+SameSite=Lax) matching the URL state (invariant ⑥)', async () => {
    const kv = new FakeKV()
    const res = await handleGoogleStart(env(kv))
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain(`${OAUTH_STATE_COOKIE_NAME}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api/auth/google')
    // The cookie value equals the state in the redirect URL — the double-submit pair.
    const stateInUrl = new URL(res.headers.get('Location') ?? '').searchParams.get('state')
    expect(cookie).toContain(`${OAUTH_STATE_COOKIE_NAME}=${stateInUrl}`)
  })

  it('redirects to /login when the Google client is unconfigured (no dead Google URL)', async () => {
    const kv = new FakeKV()
    const res = await handleGoogleStart(env(kv, { AUTH_BASE_URL: 'https://claw.amio.fans' }))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=google_unavailable')
    expect(kv.keysWithPrefix('oauth_state:')).toHaveLength(0)
  })
})

describe('GET /api/auth/google/callback — CSRF state checks (invariant ⑥)', () => {
  const identity: GoogleIdentity = { email: 'p@example.com', emailVerified: true }

  it('rejects when the oauth_state cookie is ABSENT — login-CSRF binding (no session, no exchange)', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger(identity)
    const state = await startAndGetState(kv)

    // Valid server-issued state, but the browser carries no oauth_state cookie —
    // exactly the attacker-feeds-victim-a-state scenario this binding blocks.
    const res = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state }, null),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=invalid_state')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(exchange).not.toHaveBeenCalled()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
    // The state is NOT consumed — the cookie check rejects before the KV lookup.
    expect(kv.keysWithPrefix('oauth_state:')).toHaveLength(1)
  })

  it('rejects when the oauth_state cookie does NOT match the state query param', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger(identity)
    const state = await startAndGetState(kv)

    const res = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state }, 'a-different-browsers-state'),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=invalid_state')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(exchange).not.toHaveBeenCalled()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
    expect(kv.keysWithPrefix('oauth_state:')).toHaveLength(1)
  })

  it('rejects a MISSING state with no session and no token exchange', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger(identity)
    const res = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code' }),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=invalid_state')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(exchange).not.toHaveBeenCalled()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
  })

  it('rejects an UNKNOWN state (never issued) — no session, no token exchange', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger(identity)
    const res = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state: 'never-issued-state' }),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=invalid_state')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(exchange).not.toHaveBeenCalled()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
  })

  it('rejects an EXPIRED state — modeled as the KV record being absent', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger(identity)
    // Simulate expiry: start wrote the state, but its TTL elapsed (KV evicted it).
    const state = await startAndGetState(kv)
    await kv.delete(`oauth_state:${state}`)

    const res = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state }),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=invalid_state')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(exchange).not.toHaveBeenCalled()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
  })

  it('consumes the state single-use — a replayed callback with the same state is rejected', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger(identity)
    const state = await startAndGetState(kv)

    const first = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state }),
      env(kv),
      exchange
    )
    expect(first.headers.get('Set-Cookie')).toBeTruthy()
    // State key is gone after the first use.
    expect(kv.keysWithPrefix('oauth_state:')).toHaveLength(0)

    const replay = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state }),
      env(kv),
      exchange
    )
    expect(replay.status).toBe(302)
    expect(replay.headers.get('Location')).toContain('/login?error=invalid_state')
    expect(replay.headers.get('Set-Cookie')).toBeNull()
    // No second session created.
    expect(kv.keysWithPrefix('session:')).toHaveLength(1)
  })
})

describe('GET /api/auth/google/callback — happy path', () => {
  it('creates a session with the email-derived user_id and sets a Lax/HttpOnly/Secure cookie', async () => {
    const kv = new FakeKV()
    const email = 'happy@example.com'
    const exchange = mockExchanger({ email, emailVerified: true })
    const state = await startAndGetState(kv)

    const res = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state }),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://claw.amio.fans/')
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')

    // Exactly one session, carrying the email-derived user_id.
    const sessions = kv.keysWithPrefix('session:')
    expect(sessions).toHaveLength(1)
    const record = (await kv.get(sessions[0], 'json')) as { user_id: string; email: string }
    expect(record.email).toBe(email)
    expect(record.user_id).toBe(await deriveUserId(email))
  })

  it('writes google_oauth_callback + login audit events (invariant ⑦)', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger({ email: 'p@example.com', emailVerified: true })
    const state = await startAndGetState(kv)
    await handleGoogleCallback(callbackRequest({ code: 'auth-code', state }), env(kv), exchange)

    const audit = kv.keysWithPrefix('audit:')
    expect(audit.some((k) => k.startsWith('audit:google_oauth_callback:'))).toBe(true)
    expect(audit.some((k) => k.startsWith('audit:login:'))).toBe(true)
  })
})

describe('GET /api/auth/google/callback — rejections', () => {
  it('rejects an unverified email — no session created', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger({ email: 'unverified@example.com', emailVerified: false })
    const state = await startAndGetState(kv)

    const res = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state }),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=email_unverified')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
    // The state was still consumed (a valid state was presented).
    expect(kv.keysWithPrefix('oauth_state:')).toHaveLength(0)
  })

  it('rejects when the token exchange fails — no session created', async () => {
    const kv = new FakeKV()
    const exchange: GoogleTokenExchanger = vi.fn(async () => ({ ok: false, error: 'boom' }))
    const state = await startAndGetState(kv)

    const res = await handleGoogleCallback(
      callbackRequest({ code: 'auth-code', state }),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=google_failed')
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
  })

  it('bounces back when Google reports a provider error (user denied consent)', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger({ email: 'p@example.com', emailVerified: true })
    const res = await handleGoogleCallback(
      callbackRequest({ error: 'access_denied' }),
      env(kv),
      exchange
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=google_denied')
    expect(exchange).not.toHaveBeenCalled()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
  })

  it('rejects a missing code (valid state, but no authorization code)', async () => {
    const kv = new FakeKV()
    const exchange = mockExchanger({ email: 'p@example.com', emailVerified: true })
    const state = await startAndGetState(kv)

    const res = await handleGoogleCallback(callbackRequest({ state }), env(kv), exchange)

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('/login?error=invalid')
    expect(exchange).not.toHaveBeenCalled()
    expect(kv.keysWithPrefix('session:')).toHaveLength(0)
  })
})

describe('identity convergence — Google and magic-link agree on user_id', () => {
  it('Google login yields the SAME user_id as a magic-link login for the same email', async () => {
    const email = 'shared@example.com'

    // --- Magic-link login for the email ---
    const mlKv = new FakeKV()
    const sent: MagicLinkEmail[] = []
    const sender: EmailSender = vi.fn(async (e: MagicLinkEmail) => {
      sent.push(e)
      return { sent: true }
    })
    await handleMagicLinkRequest(
      new Request('https://claw.amio.fans/api/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
      env(mlKv),
      sender
    )
    const token = new URL(sent[0].verifyUrl).searchParams.get('token') ?? ''
    await handleMagicLinkVerify(
      new Request(`https://claw.amio.fans/api/auth/magic-link/verify?token=${token}`, {
        method: 'GET',
      }),
      env(mlKv)
    )
    const mlSession = (await mlKv.get(mlKv.keysWithPrefix('session:')[0], 'json')) as {
      user_id: string
    }

    // --- Google login for the SAME email ---
    const gKv = new FakeKV()
    const exchange = mockExchanger({ email, emailVerified: true })
    const state = await startAndGetState(gKv)
    await handleGoogleCallback(callbackRequest({ code: 'auth-code', state }), env(gKv), exchange)
    const gSession = (await gKv.get(gKv.keysWithPrefix('session:')[0], 'json')) as {
      user_id: string
    }

    expect(gSession.user_id).toBe(mlSession.user_id)
  })
})

describe('createGoogleTokenExchanger — wires aud validation into the token exchange', () => {
  const AUD = 'test-client-id.apps.googleusercontent.com'

  function b64url(obj: unknown): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  }
  function idTokenWith(claims: Record<string, unknown>): string {
    return `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`
  }
  function stubTokenEndpoint(idToken: string) {
    return vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify({ id_token: idToken }), { status: 200 }))
    )
  }
  const exchEnv = (): AuthEnv => ({
    AUTH: new FakeKV().asKV(),
    AUTH_BASE_URL: 'https://claw.amio.fans',
    GOOGLE_OAUTH_CLIENT_ID: AUD,
    GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves the identity from a valid id_token', async () => {
    vi.stubGlobal(
      'fetch',
      stubTokenEndpoint(
        idTokenWith({
          aud: AUD,
          iss: 'https://accounts.google.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          email: 'ok@example.com',
          email_verified: true,
        })
      )
    )
    const result = await createGoogleTokenExchanger(exchEnv())('auth-code')
    expect(result).toMatchObject({ ok: true, identity: { email: 'ok@example.com' } })
  })

  it('rejects an id_token whose aud is another client (validation is wired in)', async () => {
    vi.stubGlobal(
      'fetch',
      stubTokenEndpoint(
        idTokenWith({
          aud: 'attacker-client.apps.googleusercontent.com',
          iss: 'https://accounts.google.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          email: 'ok@example.com',
          email_verified: true,
        })
      )
    )
    const result = await createGoogleTokenExchanger(exchEnv())('auth-code')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/aud/)
  })
})

describe('decodeGoogleIdToken — claim validation (aud / iss / exp)', () => {
  const AUD = 'test-client-id.apps.googleusercontent.com'
  const NOW = 1_700_000_000 // fixed wall clock for deterministic exp checks

  /** Build a fake unsigned JWT (header.payload.signature) for the decode test.
      Uses the Workers-global btoa (not Node's Buffer — the api tsconfig has no
      @types/node), mirroring the atob the production decoder relies on.
      Defaults to valid aud / iss / exp so each test overrides only its target. */
  function fakeIdToken(claims: Record<string, unknown>): string {
    const full = {
      aud: AUD,
      iss: 'https://accounts.google.com',
      exp: NOW + 3600, // valid: one hour out
      ...claims,
    }
    const b64url = (obj: unknown) =>
      btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
    return `${b64url({ alg: 'RS256' })}.${b64url(full)}.sig`
  }

  it('reads email + email_verified from a valid token', () => {
    const r = decodeGoogleIdToken(fakeIdToken({ email: 'a@b.com', email_verified: true }), AUD, NOW)
    expect(r).toEqual({ ok: true, identity: { email: 'a@b.com', emailVerified: true } })
  })

  it('treats the string "true" as verified (Google sometimes stringifies the claim)', () => {
    const r = decodeGoogleIdToken(
      fakeIdToken({ email: 'a@b.com', email_verified: 'true' }),
      AUD,
      NOW
    )
    expect(r.ok && r.identity.emailVerified).toBe(true)
  })

  it('reports an unverified claim (decoder surfaces, callback enforces)', () => {
    const r = decodeGoogleIdToken(
      fakeIdToken({ email: 'a@b.com', email_verified: false }),
      AUD,
      NOW
    )
    expect(r.ok && r.identity.emailVerified).toBe(false)
  })

  it('rejects a malformed token and a token missing email', () => {
    expect(decodeGoogleIdToken('not-a-jwt', AUD, NOW)).toMatchObject({ ok: false })
    expect(decodeGoogleIdToken(fakeIdToken({ email: undefined }), AUD, NOW)).toMatchObject({
      ok: false,
    })
  })

  it('rejects a WRONG aud — a token minted for another client', () => {
    const r = decodeGoogleIdToken(
      fakeIdToken({ aud: 'someone-elses-client.apps.googleusercontent.com', email: 'a@b.com' }),
      AUD,
      NOW
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/aud/)
  })

  it('rejects a WRONG iss — a token not from Google', () => {
    const r = decodeGoogleIdToken(
      fakeIdToken({ iss: 'https://evil.example.com', email: 'a@b.com' }),
      AUD,
      NOW
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/iss/)
  })

  it('accepts the bare-host issuer spelling (accounts.google.com)', () => {
    const r = decodeGoogleIdToken(
      fakeIdToken({ iss: 'accounts.google.com', email: 'a@b.com' }),
      AUD,
      NOW
    )
    expect(r.ok).toBe(true)
  })

  it('rejects an EXPIRED token (exp in the past, beyond the skew leeway)', () => {
    const r = decodeGoogleIdToken(
      fakeIdToken({ exp: NOW - 3600, email: 'a@b.com' }), // expired an hour ago
      AUD,
      NOW
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/expired/)
  })

  it('rejects a token missing exp entirely', () => {
    const r = decodeGoogleIdToken(fakeIdToken({ exp: undefined, email: 'a@b.com' }), AUD, NOW)
    expect(r.ok).toBe(false)
  })
})
