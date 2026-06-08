/**
 * POST /api/auth/magic-link/request
 *
 * Build a one-time token, store ONLY its SHA-256 hash under
 * `magiclink:<sha256>` with a ≤15-min TTL (invariants ① TTL + ② hash-only),
 * then send the verify link via the injected `EmailSender`. Returns the SAME
 * unified response in every branch — known email, unknown email, malformed
 * email, or rate-limited — so the endpoint leaks no enumeration signal
 * (invariant ④). Per-email send cap enforced (invariant ③).
 *
 * The token value stored in KV is the identity payload the verify step needs:
 * `{ email }`. No plaintext token, no user store lookup — proving ownership of
 * the inbox IS the identity check.
 */

import type { AuthEnv } from '../auth/config'
import type { EmailSender } from '../auth/email'
import { resolveBaseUrl, MAGIC_LINK_TTL_SECONDS } from '../auth/config'
import { generateToken, hashToken } from '../auth/crypto'
import { magicLinkKey } from '../auth/kv-keys'
import { checkEmailSendLimit } from '../auth/rate-limit'
import { writeAudit } from '../auth/audit'
import { normalizeEmail, unifiedMagicLinkResponse } from '../auth/respond'

/** Value stored under `magiclink:<sha256>` — the proven-on-verify identity. */
export interface MagicLinkRecord {
  email: string
}

export async function handleMagicLinkRequest(
  request: Request,
  env: AuthEnv,
  sendEmail: EmailSender
): Promise<Response> {
  let email: string | null
  try {
    const body = (await request.json()) as { email?: unknown }
    email = normalizeEmail(body.email)
  } catch {
    email = null
  }

  // Malformed email: still return the unified response (no enumeration signal),
  // but do no work.
  if (!email) return unifiedMagicLinkResponse()

  // Per-email send cap. On exceed, silently return the unified response so a
  // throttled address is indistinguishable from a fresh one.
  const allowed = await checkEmailSendLimit(env.AUTH, email)
  if (!allowed) return unifiedMagicLinkResponse()

  const token = generateToken()
  const tokenHash = await hashToken(token)
  const record: MagicLinkRecord = { email }
  await env.AUTH.put(magicLinkKey(tokenHash), JSON.stringify(record), {
    expirationTtl: MAGIC_LINK_TTL_SECONDS,
  })

  const verifyUrl = buildVerifyUrl(resolveBaseUrl(env), token)
  const result = await sendEmail({ to: email, verifyUrl })

  await writeAudit(env.AUTH, 'magic_link_request', {
    email,
    reason: result.sent ? undefined : result.error,
  })

  return unifiedMagicLinkResponse()
}

function buildVerifyUrl(baseUrl: string, token: string): string {
  const url = new URL('/api/auth/magic-link/verify', baseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}
