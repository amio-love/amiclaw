/**
 * Auth runtime configuration + the `AUTH` binding env shape.
 *
 * The `AUTH` KV namespace and the auth secrets are bound to the Cloudflare
 * Pages project, NOT in a checked-in wrangler file (the project has no
 * `wrangler.toml` — `LEADERBOARD` and `DASHBOARD_TOKEN` are likewise attached
 * via the Pages dashboard). See `functions/api/auth/PROVISIONING.md` for the
 * exact out-of-band steps the maintainer must run.
 *
 * Every value has a safe dev fallback so `pnpm dev` and the test runner work
 * with zero configuration; production overrides them via Pages env / secrets.
 */

import { MAGIC_LINK_TTL_MINUTES, MAGIC_LINK_HOURLY_SEND_LIMIT } from '../../../../shared/auth-types'

export interface AuthEnv {
  /** `AUTH` KV namespace — token hashes, sessions, audit, rate-limit counters. */
  AUTH: KVNamespace
  /** Resend API key (secret). When unset, email send is logged, not sent. */
  RESEND_API_KEY?: string
  /** Verified Resend sending address, e.g. `AMIO Arcade <login@claw.amio.fans>`. */
  AUTH_EMAIL_FROM?: string
  /**
   * Origin used to build the magic-link verify URL and the post-login redirect
   * target. Defaults to the production canonical; override per-environment.
   */
  AUTH_BASE_URL?: string
  /**
   * Google OAuth 2.0 client id (public). When unset, `/api/auth/google/start`
   * has nothing to redirect to and reports the provider as unconfigured.
   */
  GOOGLE_OAUTH_CLIENT_ID?: string
  /** Google OAuth 2.0 client secret. Used only server-side in the token exchange. */
  GOOGLE_OAUTH_CLIENT_SECRET?: string
}

// --- Tunables (invariant-bearing) -----------------------------------------

/** Magic-link token TTL — invariant ①: ≤ 15 minutes. Minutes SSOT lives in
 *  shared/auth-types.ts so the login-page copy can never drift from this TTL. */
export const MAGIC_LINK_TTL_SECONDS = MAGIC_LINK_TTL_MINUTES * 60

/** Opaque session lifetime. No sliding renewal in this round (Open Question). */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

/** Audit-log retention. */
export const AUDIT_TTL_SECONDS = 90 * 24 * 60 * 60 // 90 days

/** Invariant ③ — per-email send cap within the window. Cap SSOT lives in
 *  shared/auth-types.ts so the login-page resend copy states the real limit. */
export const EMAIL_SEND_LIMIT = MAGIC_LINK_HOURLY_SEND_LIMIT
export const EMAIL_SEND_WINDOW_SECONDS = 60 * 60 // 1 hour

/** Invariant ③ — global verify-endpoint cap within the window. */
export const VERIFY_GLOBAL_LIMIT = 1000
export const VERIFY_GLOBAL_WINDOW_SECONDS = 60 // per minute

/** OAuth `state` lifetime — short, single-use; covers the consent round-trip (invariant ⑥). */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60 // 10 minutes

// --- Dev fallbacks ----------------------------------------------------------

const DEFAULT_BASE_URL = 'https://claw.amio.fans'
const DEFAULT_EMAIL_FROM = 'AMIO Arcade <onboarding@resend.dev>'

export function resolveBaseUrl(env: AuthEnv): string {
  return env.AUTH_BASE_URL && env.AUTH_BASE_URL.length > 0 ? env.AUTH_BASE_URL : DEFAULT_BASE_URL
}

export function resolveEmailFrom(env: AuthEnv): string {
  return env.AUTH_EMAIL_FROM && env.AUTH_EMAIL_FROM.length > 0
    ? env.AUTH_EMAIL_FROM
    : DEFAULT_EMAIL_FROM
}

/**
 * The Google OAuth `redirect_uri` — the callback endpoint on this origin. It is
 * derived from the base URL (NOT separately configured) so it can never drift
 * from the deployment; the exact string here MUST be registered verbatim as an
 * authorized redirect URI in the Google Cloud OAuth client (see PROVISIONING.md).
 */
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback'

export function resolveGoogleRedirectUri(env: AuthEnv): string {
  return new URL(GOOGLE_CALLBACK_PATH, resolveBaseUrl(env)).toString()
}
