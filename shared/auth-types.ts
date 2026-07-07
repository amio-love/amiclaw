/**
 * Cross-container wire shapes for the Auth Session component (mode② paid path).
 *
 * SSOT for the auth wire contract: the session cookie name, the request /
 * verify / session / logout JSON shapes, and the identity object the frontend
 * `useAuth` consumes via `GET /api/auth/session`. Lives in `shared/` alongside
 * `leaderboard-types.ts` so both the Workers handlers and (Round 2) the
 * frontend import one definition.
 *
 * Architecture SSOT: arch-component-auth-session.
 */

/** Session cookie name carrying the opaque session id. */
export const SESSION_COOKIE_NAME = 'amiclaw_session'

/**
 * Magic-link token TTL in minutes — invariant ①: ≤ 15 minutes. SSOT for both
 * the KV expirationTtl (packages/api auth config) and the login-page validity
 * copy, so the promise shown to the player can never drift from the backend.
 */
export const MAGIC_LINK_TTL_MINUTES = 15

/**
 * Per-email magic-link send cap within one hour — invariant ③. SSOT for both
 * the KV rate-limit counter (packages/api auth config) and the login-page
 * resend copy. The backend swallows over-cap sends behind the unified
 * anti-enumeration response, so the frontend states the cap honestly instead
 * of pretending it can detect a throttle.
 */
export const MAGIC_LINK_HOURLY_SEND_LIMIT = 5

/** Body of `POST /api/auth/magic-link/request`. */
export interface MagicLinkRequestBody {
  email: string
}

/**
 * Unified response of `POST /api/auth/magic-link/request`.
 *
 * Anti-enumeration (invariant ④): the exact same object is returned whether or
 * not the email is known, and whether or not a send was actually attempted
 * (e.g. when the per-email rate limit was hit). The client can never tell a
 * registered address from an unregistered one.
 */
export interface MagicLinkRequestResponse {
  ok: true
  message: string
}

/** Authenticated identity surfaced to the frontend by `GET /api/auth/session`. */
export interface AuthIdentity {
  user_id: string
  email: string
}

/**
 * Response of `GET /api/auth/session`.
 *
 * `authenticated: false` with `identity: null` is the anonymous case — it is a
 * 200, not a 401, because reading "am I logged in?" is always a legal query.
 */
export interface SessionResponse {
  authenticated: boolean
  identity: AuthIdentity | null
}

/** Response of `POST /api/auth/logout`. Idempotent — always `ok: true`. */
export interface LogoutResponse {
  ok: true
}
