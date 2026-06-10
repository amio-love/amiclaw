/**
 * GET /api/auth/session
 *
 * Reads the current session from the request cookie (via the shared
 * session-reader) and returns the identity, or the anonymous state. Always
 * 200 — "am I logged in?" is a legal query for anyone. Consumed by the
 * frontend `useAuth` (Round 2).
 */

import type { AuthEnv } from '../auth/config'
import type { SessionResponse } from '../../../../shared/auth-types'
import { readSessionFromRequest } from '../auth/session'
import { jsonResponse } from '../auth/respond'

export async function handleGetSession(request: Request, env: AuthEnv): Promise<Response> {
  const session = await readSessionFromRequest(env.AUTH, request)
  const body: SessionResponse = session
    ? { authenticated: true, identity: { user_id: session.user_id, email: session.email } }
    : { authenticated: false, identity: null }
  // no-store: a session-state response must never be cached by a shared cache.
  return jsonResponse(body, 200, { 'Cache-Control': 'no-store' })
}
