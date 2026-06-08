/**
 * GET /api/auth/google/start
 *
 * Begin the Google OAuth 2.0 web-server flow: generate a random `state`, store
 * it in KV under `oauth_state:<state>` with a short TTL (invariant ⑥ — the
 * callback verifies and single-use-consumes it to block CSRF), then 302-redirect
 * the browser to Google's consent screen carrying `client_id`, `redirect_uri`,
 * `response_type=code`, the minimal `openid email` scope, and the `state`.
 *
 * When the Google client id is unconfigured (no secret bound), there is nothing
 * to redirect to — we send the player back to /login with an error rather than
 * bouncing to a broken Google URL.
 */

import type { AuthEnv } from '../auth/config'
import { resolveBaseUrl, OAUTH_STATE_TTL_SECONDS } from '../auth/config'
import { generateToken } from '../auth/crypto'
import { oauthStateKey } from '../auth/kv-keys'
import { buildGoogleAuthUrl } from '../auth/google-oauth'

/** Value stored under `oauth_state:<state>` — enough to validate the callback. */
export interface OAuthStateRecord {
  created_at: string // ISO 8601
}

export async function handleGoogleStart(env: AuthEnv): Promise<Response> {
  const baseUrl = resolveBaseUrl(env)

  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    return redirect(loginUrl(baseUrl, 'google_unavailable'))
  }

  // High-entropy, unguessable CSRF token (32 random bytes, hex). Stored
  // server-side so the callback can confirm it originated here.
  const state = generateToken()
  const record: OAuthStateRecord = { created_at: new Date().toISOString() }
  await env.AUTH.put(oauthStateKey(state), JSON.stringify(record), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  })

  return redirect(buildGoogleAuthUrl(env, state))
}

function redirect(location: string): Response {
  // 302: the start GET is a one-shot top-level navigation to Google.
  return new Response(null, { status: 302, headers: { Location: location } })
}

function loginUrl(baseUrl: string, error: string): string {
  const url = new URL('/login', baseUrl)
  url.searchParams.set('error', error)
  return url.toString()
}
