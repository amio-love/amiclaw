/**
 * POST /api/auth/logout
 *
 * Revokes the current session server-side (deletes `session:<id>` — invariant
 * ⑦) and clears the cookie. Idempotent: a request with no / unknown session
 * still returns `ok: true` with a cleared cookie. Writes a `logout` audit
 * event when a session was actually present.
 */

import type { AuthEnv } from '../auth/config'
import type { LogoutResponse } from '../../../../shared/auth-types'
import {
  readSessionCookie,
  readSession,
  revokeSession,
  buildClearedSessionCookie,
} from '../auth/session'
import { writeAudit } from '../auth/audit'
import { jsonResponse } from '../auth/respond'

export async function handleLogout(request: Request, env: AuthEnv): Promise<Response> {
  const sessionId = readSessionCookie(request)
  if (sessionId) {
    // Read first so the audit entry can record who logged out.
    const session = await readSession(env.AUTH, sessionId)
    await revokeSession(env.AUTH, sessionId)
    if (session) {
      await writeAudit(env.AUTH, 'logout', { user_id: session.user_id, email: session.email })
    }
  }
  const body: LogoutResponse = { ok: true }
  return jsonResponse(body, 200, { 'Set-Cookie': buildClearedSessionCookie() })
}
