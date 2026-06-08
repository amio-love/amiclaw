/**
 * GET /api/auth/google/callback?code=...&state=...
 *
 * The convergence point with magic-link: once the email is proven (here via
 * Google rather than via inbox possession), this derives the SAME email-keyed
 * identity through `deriveUserId` and creates the SAME opaque KV session via
 * `createSession` + `buildSessionCookie` — so Google and magic-link for one
 * email yield one `user_id` and one session shape.
 *
 * Order of checks (security-load-bearing):
 *   (a) verify `state` against `oauth_state:<state>` and single-use-consume it
 *       — reject on missing / unknown / expired (invariant ⑥ CSRF). The state
 *       is deleted BEFORE the token exchange so a replayed callback finds none.
 *   (b) exchange the authorization `code` for tokens (injected exchanger).
 *   (c) read email + email_verified from the id_token; REJECT if not verified.
 *   (d) derive identity, (e) create session + set cookie, (f) write audit,
 *   (g) 302-redirect to the post-login landing.
 *
 * Every rejection redirects to /login?error=... and sets NO cookie.
 */

import type { AuthEnv } from '../auth/config'
import type { AuthIdentity } from '../../../../shared/auth-types'
import { resolveBaseUrl } from '../auth/config'
import { oauthStateKey } from '../auth/kv-keys'
import { createSession, buildSessionCookie } from '../auth/session'
import { writeAudit } from '../auth/audit'
import { deriveUserId } from '../auth/identity'
import type { GoogleTokenExchanger } from '../auth/google-oauth'

export async function handleGoogleCallback(
  request: Request,
  env: AuthEnv,
  exchangeCode: GoogleTokenExchanger
): Promise<Response> {
  const baseUrl = resolveBaseUrl(env)
  const url = new URL(request.url)

  // Google reports user-side denial / errors via an `error` param. Bounce back.
  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    await writeAudit(env.AUTH, 'oauth_failed', { reason: `provider error: ${oauthError}` })
    return redirect(loginUrl(baseUrl, 'google_denied'))
  }

  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')

  // (a) State first — invariant ⑥. Missing / unknown / expired state is a CSRF
  // signal: reject before touching the code. Consume single-use so a replayed
  // callback (same state) cannot be reused.
  if (!state) {
    await writeAudit(env.AUTH, 'oauth_failed', { reason: 'missing state' })
    return redirect(loginUrl(baseUrl, 'invalid_state'))
  }
  const stateKey = oauthStateKey(state)
  const stateRecord = await env.AUTH.get(stateKey, 'json')
  if (!stateRecord) {
    await writeAudit(env.AUTH, 'oauth_failed', { reason: 'unknown or expired state' })
    return redirect(loginUrl(baseUrl, 'invalid_state'))
  }
  await env.AUTH.delete(stateKey)

  if (!code) {
    await writeAudit(env.AUTH, 'oauth_failed', { reason: 'missing code' })
    return redirect(loginUrl(baseUrl, 'invalid'))
  }

  // (b) Exchange the code for tokens (mockable seam — tests never hit Google).
  const exchange = await exchangeCode(code)
  if (!exchange.ok || !exchange.identity) {
    await writeAudit(env.AUTH, 'oauth_failed', {
      reason: exchange.error ?? 'token exchange failed',
    })
    return redirect(loginUrl(baseUrl, 'google_failed'))
  }

  // (c) Reject an unverified email — an unverified Google address does not prove
  // inbox ownership, so it must not seed an identity.
  if (!exchange.identity.emailVerified) {
    await writeAudit(env.AUTH, 'oauth_failed', {
      reason: 'email not verified',
      email: exchange.identity.email,
    })
    return redirect(loginUrl(baseUrl, 'email_unverified'))
  }

  // (d) Derive the SAME email-keyed identity magic-link uses.
  const identity: AuthIdentity = {
    email: exchange.identity.email,
    user_id: await deriveUserId(exchange.identity.email),
  }

  // (e) Same opaque KV session + same cookie as the magic-link verify path.
  const { sessionId } = await createSession(env.AUTH, identity)

  // (f) Audit the OAuth sign-in (invariant ⑦).
  await writeAudit(env.AUTH, 'google_oauth_callback', {
    email: identity.email,
    user_id: identity.user_id,
  })
  await writeAudit(env.AUTH, 'login', { email: identity.email, user_id: identity.user_id })

  // (g) Land the player, carrying the freshly-set Lax cookie.
  return redirect(landingUrl(baseUrl), buildSessionCookie(sessionId))
}

function redirect(location: string, setCookie?: string): Response {
  const headers: Record<string, string> = { Location: location }
  if (setCookie) headers['Set-Cookie'] = setCookie
  // 302: the callback GET is a one-shot navigation; the browser follows to the
  // landing carrying the freshly-set Lax cookie (top-level GET navigation).
  return new Response(null, { status: 302, headers })
}

function landingUrl(baseUrl: string): string {
  return new URL('/', baseUrl).toString()
}

function loginUrl(baseUrl: string, error: string): string {
  const url = new URL('/login', baseUrl)
  url.searchParams.set('error', error)
  return url.toString()
}
