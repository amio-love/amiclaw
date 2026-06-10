/**
 * GET /api/auth/magic-link/verify?token=...
 *
 * Hash the presented token, look up `magiclink:<sha256>`. On hit: consume it
 * single-use (delete the key — invariant ①), derive the identity, create an
 * opaque KV session, set the HttpOnly + Secure + SameSite=Lax cookie
 * (invariant ⑤), and 302-redirect to the post-login landing. On miss / expiry:
 * redirect to the login page with an error flag (no session set).
 *
 * Global verify-endpoint rate limit applied first (invariant ③).
 *
 * Prefetch double-consume (Open Question in the spec): we delete the token
 * BEFORE creating the session, so the first GET — whether a mail-client
 * prefetch or the real click — wins and any second GET sees a miss. This makes
 * the link truly single-use; the residual risk is a security-scanner prefetch
 * "using up" a link before the human clicks (they simply request a new one).
 * This is recorded as accepted residual risk rather than solved with a nonce.
 */

import type { AuthEnv } from '../auth/config'
import type { AuthIdentity } from '../../../../shared/auth-types'
import { resolveBaseUrl } from '../auth/config'
import { hashToken } from '../auth/crypto'
import { magicLinkKey } from '../auth/kv-keys'
import { checkVerifyGlobalLimit } from '../auth/rate-limit'
import { createSession, buildSessionCookie } from '../auth/session'
import { writeAudit } from '../auth/audit'
import { deriveUserId } from '../auth/identity'
import type { MagicLinkRecord } from './auth-magic-link-request'

export async function handleMagicLinkVerify(request: Request, env: AuthEnv): Promise<Response> {
  const baseUrl = resolveBaseUrl(env)

  // Global verify cap — protects the endpoint from brute-force / scanning.
  const underLimit = await checkVerifyGlobalLimit(env.AUTH)
  if (!underLimit) {
    return redirect(loginUrl(baseUrl, 'rate_limited'))
  }

  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) {
    await writeAudit(env.AUTH, 'verify_failed', { reason: 'missing token' })
    return redirect(loginUrl(baseUrl, 'invalid'))
  }

  const tokenHash = await hashToken(token)
  const key = magicLinkKey(tokenHash)
  const record = (await env.AUTH.get(key, 'json')) as MagicLinkRecord | null
  if (!record) {
    await writeAudit(env.AUTH, 'verify_failed', { reason: 'token not found or expired' })
    return redirect(loginUrl(baseUrl, 'invalid'))
  }

  // Single-use consume FIRST (invariant ①). Deleting before session creation
  // means a concurrent second GET (prefetch) finds nothing.
  await env.AUTH.delete(key)

  const identity: AuthIdentity = {
    email: record.email,
    user_id: await deriveUserId(record.email),
  }
  const { sessionId } = await createSession(env.AUTH, identity)

  await writeAudit(env.AUTH, 'magic_link_verify', {
    email: identity.email,
    user_id: identity.user_id,
  })
  await writeAudit(env.AUTH, 'login', {
    email: identity.email,
    user_id: identity.user_id,
  })

  return redirect(landingUrl(baseUrl), buildSessionCookie(sessionId))
}

function redirect(location: string, setCookie?: string): Response {
  const headers: Record<string, string> = { Location: location }
  if (setCookie) headers['Set-Cookie'] = setCookie
  // 302: the verify GET is a one-shot navigation; the browser follows to the
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
