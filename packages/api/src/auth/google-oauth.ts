/**
 * Google OAuth 2.0 web-server flow — URL builder + injectable token exchanger.
 *
 * The single outbound `fetch` to Google's token endpoint is isolated behind the
 * `GoogleTokenExchanger` seam (mirroring `EmailSender` in email.ts): the
 * callback handler takes an exchanger as an argument so tests inject a mock and
 * NEVER hit live Google. The Google-backed exchanger built from the env is the
 * only place the real network call lives, so the wire contract is easy to audit.
 *
 * Workers path: Web Crypto + `fetch` only — no Google Node SDK (which would
 * pull a Node-only dependency into the Workers runtime).
 *
 * id_token handling — what IS and ISN'T validated:
 *
 *   VALIDATED (before returning ok):
 *     - `aud` === our `GOOGLE_OAUTH_CLIENT_ID` — the token was minted for THIS
 *       client, not some other app's id_token replayed at us.
 *     - `iss` ∈ { accounts.google.com, https://accounts.google.com } — it came
 *       from Google's issuer.
 *     - `exp` is in the future (with a small clock-skew leeway) — not expired.
 *     - `email` present, and `email_verified` reported (the callback enforces it).
 *
 *   INTENTIONALLY SKIPPED:
 *     - JWT *signature* verification. The token is read directly from Google's
 *       token endpoint over TLS in a server-to-server call, so its provenance is
 *       already established by the channel — Google's OIDC guidance sanctions
 *       skipping signature checks for the authorization-code flow PROVIDED the
 *       audience is checked, which is exactly why the `aud` check above is not
 *       optional. Signature verification would be required only if the id_token
 *       arrived via an untrusted channel (e.g. the implicit flow) — that is not
 *       what this is.
 */

import type { AuthEnv } from './config'
import { resolveGoogleRedirectUri, OAUTH_STATE_TTL_SECONDS } from './config'

/** Google OAuth 2.0 endpoints. Stable, long-lived; isolated here for auditing. */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/**
 * Name of the short-lived cookie that binds the OAuth `state` to the initiating
 * browser. The callback double-submits this against the `state` query param: the
 * KV record proves OUR server issued the state, the cookie proves THIS browser
 * initiated the flow. Without the cookie binding, an attacker could feed a
 * victim a server-issued state + attacker code and log the victim into the
 * attacker's account (login-CSRF / session fixation) — invariant ⑥.
 */
export const OAUTH_STATE_COOKIE_NAME = 'oauth_state'

/**
 * Cookie scoped to the Google auth routes only, HttpOnly + Secure + SameSite=Lax
 * (Lax so the cookie rides the top-level GET navigation back from Google).
 */
export function buildOAuthStateCookie(state: string): string {
  return [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}`,
    'Path=/api/auth/google',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${OAUTH_STATE_TTL_SECONDS}`,
  ].join('; ')
}

/** Clear the OAuth state cookie (same attributes, Max-Age=0) once consumed. */
export function buildClearedOAuthStateCookie(): string {
  return [
    `${OAUTH_STATE_COOKIE_NAME}=`,
    'Path=/api/auth/google',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ')
}

/** Minimal scope — we only need the verified email to derive the identity. */
export const GOOGLE_SCOPE = 'openid email'

/** Accepted `iss` values — Google issues the id_token under either spelling. */
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

/** Clock-skew leeway for the `exp` check, in seconds. */
export const ID_TOKEN_CLOCK_SKEW_SECONDS = 60

/** Identity claims we read out of the exchanged id_token. */
export interface GoogleIdentity {
  email: string
  /**
   * Google's own verification of the address, as REPORTED by this decoder. The
   * decoder only surfaces the claim; the callback handler is what ENFORCES it
   * (rejecting the sign-in when it is false). See auth-google-callback.ts.
   */
  emailVerified: boolean
}

export interface ExchangeResult {
  ok: boolean
  identity?: GoogleIdentity
  /** Present on failure; used for audit / logging, never returned to the client. */
  error?: string
}

/**
 * Exchange an authorization `code` for tokens and resolve the Google identity.
 * Injected into the callback handler so tests never hit live Google.
 */
export type GoogleTokenExchanger = (code: string) => Promise<ExchangeResult>

/**
 * Build the Google consent-screen URL for `/api/auth/google/start`.
 *
 * `state` is the CSRF token (invariant ⑥) the caller has already stored in KV;
 * `response_type=code` selects the authorization-code flow; `redirect_uri` is
 * derived from the base URL so it cannot drift from the deployment.
 */
export function buildGoogleAuthUrl(env: AuthEnv, state: string): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID ?? '')
  url.searchParams.set('redirect_uri', resolveGoogleRedirectUri(env))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPE)
  url.searchParams.set('state', state)
  // Force account chooser rather than silent re-auth, and ask for a normal
  // (non-offline) grant — we do not need a refresh token for a one-shot login.
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

/** Shape of Google's token-endpoint JSON response (only the field we read). */
interface GoogleTokenResponse {
  id_token?: string
}

/** Claims we read from the id_token payload. */
interface GoogleIdTokenClaims {
  /** Audience — MUST equal our client id. */
  aud?: string
  /** Issuer — MUST be one of GOOGLE_ISSUERS. */
  iss?: string
  /** Expiry, seconds since epoch — MUST be in the future (with leeway). */
  exp?: number
  email?: string
  // Google may send this as a real boolean or as the string "true".
  email_verified?: boolean | string
}

/** Outcome of validating + decoding an id_token. */
export type IdTokenResult = { ok: true; identity: GoogleIdentity } | { ok: false; error: string }

/**
 * Build the real Google-backed exchanger from the env. When the client id /
 * secret are unset (local dev / preview without secrets) the exchanger fails
 * cleanly with a descriptive error instead of making a doomed network call — so
 * a misconfigured deployment surfaces as a clean callback failure, never a hang.
 */
export function createGoogleTokenExchanger(env: AuthEnv): GoogleTokenExchanger {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return async () => ({ ok: false, error: 'Google OAuth client not configured' })
  }

  const redirectUri = resolveGoogleRedirectUri(env)

  return async (code: string) => {
    try {
      const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        return { ok: false, error: `Google token ${response.status}: ${detail.slice(0, 200)}` }
      }
      const tokens = (await response.json()) as GoogleTokenResponse
      if (!tokens.id_token) {
        return { ok: false, error: 'Google token response missing id_token' }
      }
      // Validate aud/iss/exp against THIS client before trusting the claims.
      const decoded = decodeGoogleIdToken(tokens.id_token, clientId)
      if (!decoded.ok) {
        return { ok: false, error: decoded.error }
      }
      return { ok: true, identity: decoded.identity }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'token exchange failed' }
    }
  }
}

/**
 * Decode + validate the id_token payload.
 *
 * Checks `aud` (=== `expectedAud`), `iss` (∈ GOOGLE_ISSUERS), and `exp` (in the
 * future, with ID_TOKEN_CLOCK_SKEW_SECONDS leeway) before surfacing the identity
 * — see the file header for the full validated/skipped contract. The JWT
 * *signature* is deliberately NOT verified (token read directly from Google's
 * token endpoint over TLS + the `aud` check above). Returns a discriminated
 * result so the caller can audit the exact failure reason.
 *
 * `nowSeconds` is injectable so the `exp` check is testable; it defaults to the
 * current wall-clock time.
 */
export function decodeGoogleIdToken(
  idToken: string,
  expectedAud: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): IdTokenResult {
  const parts = idToken.split('.')
  if (parts.length !== 3) return { ok: false, error: 'malformed id_token (not a JWT)' }

  let claims: GoogleIdTokenClaims
  try {
    claims = JSON.parse(base64UrlDecode(parts[1])) as GoogleIdTokenClaims
  } catch {
    return { ok: false, error: 'could not decode id_token claims' }
  }

  // aud — the token must have been minted for THIS client.
  if (claims.aud !== expectedAud) {
    return { ok: false, error: 'id_token aud mismatch' }
  }
  // iss — it must come from Google's issuer.
  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.includes(claims.iss)) {
    return { ok: false, error: 'id_token iss not Google' }
  }
  // exp — it must not be expired (small skew leeway).
  if (typeof claims.exp !== 'number' || claims.exp + ID_TOKEN_CLOCK_SKEW_SECONDS <= nowSeconds) {
    return { ok: false, error: 'id_token expired' }
  }
  // email — required to derive the identity.
  if (typeof claims.email !== 'string' || claims.email.length === 0) {
    return { ok: false, error: 'id_token missing email' }
  }

  return {
    ok: true,
    identity: {
      email: claims.email,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    },
  }
}

/** Decode a base64url string to UTF-8. Works in the Workers runtime (atob is global). */
function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
