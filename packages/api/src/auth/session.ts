/**
 * Opaque KV session create / read / revoke + the session cookie helpers.
 *
 * The session is a random opaque id (not a JWT) so server-side state in
 * `session:<id>` can be revoked instantly on logout (invariant ⑦ — revocable).
 * The id is carried in an HttpOnly + Secure + SameSite=Lax cookie (invariant
 * ⑤ — Lax, not Strict, so the cross-site verify-redirect landing still sends
 * the cookie).
 */

import type { AuthIdentity } from '../../../../shared/auth-types'
import { SESSION_COOKIE_NAME } from '../../../../shared/auth-types'
import { generateSessionId } from './crypto'
import { sessionKey } from './kv-keys'
import { SESSION_TTL_SECONDS } from './config'

/** Server-side session record stored under `session:<id>`. */
export interface SessionRecord {
  user_id: string
  email: string
  created_at: string // ISO 8601
}

/**
 * Create a session for an identity: write `session:<id>` with a TTL and return
 * both the id and the record. The id is opaque and unguessable (UUID v4).
 */
export async function createSession(
  kv: KVNamespace,
  identity: AuthIdentity
): Promise<{ sessionId: string; record: SessionRecord }> {
  const sessionId = generateSessionId()
  const record: SessionRecord = {
    user_id: identity.user_id,
    email: identity.email,
    created_at: new Date().toISOString(),
  }
  await kv.put(sessionKey(sessionId), JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SECONDS,
  })
  return { sessionId, record }
}

/** Read the session record for an id, or `null` if absent / revoked. */
export async function readSession(
  kv: KVNamespace,
  sessionId: string
): Promise<SessionRecord | null> {
  if (!sessionId) return null
  return (await kv.get(sessionKey(sessionId), 'json')) as SessionRecord | null
}

/** Revoke a session by deleting its server-side record (invariant ⑦). */
export async function revokeSession(kv: KVNamespace, sessionId: string): Promise<void> {
  if (!sessionId) return
  await kv.delete(sessionKey(sessionId))
}

/**
 * Read the current session straight off a request's cookie. Shared by the
 * guard middleware and `GET /api/auth/session` so both resolve identity the
 * exact same way.
 */
export async function readSessionFromRequest(
  kv: KVNamespace,
  request: Request
): Promise<SessionRecord | null> {
  const sessionId = readSessionCookie(request)
  if (!sessionId) return null
  return readSession(kv, sessionId)
}

/**
 * Decode a cookie value without ever throwing on attacker-controlled input.
 * Malformed percent escapes stay raw, which fails closed downstream because no
 * real session id should match that raw garbage value.
 */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Read a single cookie value by name from a request's `Cookie` header, or
 * `null`. Shared by the session reader and the OAuth state-cookie check so the
 * (slightly fiddly) parse loop lives in one place.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const cookieName = part.slice(0, eq).trim()
    if (cookieName === name) {
      return decodeCookieValue(part.slice(eq + 1).trim())
    }
  }
  return null
}

/** Extract the session id from the `Cookie` header, or `null`. */
export function readSessionCookie(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE_NAME)
}

/**
 * Build the `Set-Cookie` value that plants the session id.
 *
 * HttpOnly (no JS access) + Secure (HTTPS only) + SameSite=Lax (invariant ⑤).
 * Path=/ so every route sees it; Max-Age pins the cookie lifetime to the
 * server-side session TTL.
 */
export function buildSessionCookie(sessionId: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join('; ')
}

/** Build the `Set-Cookie` value that clears the session cookie on logout. */
export function buildClearedSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ')
}
