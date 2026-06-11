/**
 * `requireSession` — the login-required guard for endpoint families with no
 * legal anonymous form (`/api/companion/*`).
 *
 * Distinct from `guard.ts` (`guardClaimedUserId`), which is claim-matching
 * for endpoints that are legal anonymously and only check a session when a
 * request CLAIMS a `user_id`. Here the semantics are require-session: no
 * valid session cookie -> 401, full stop — and the owner `user_id` is
 * whatever the server-side session says. Callers must never read an owner id
 * from the request body or query string; this helper is the only identity
 * source for the companion control plane.
 *
 * Built ON TOP of the shared session-reader (`readSessionFromRequest`) — the
 * auth-session contract files are reused read-only, not modified.
 */

import { readSessionFromRequest, type SessionRecord } from './session'
import { jsonResponse } from './respond'

export type RequireSessionResult =
  | { ok: true; session: SessionRecord }
  | { ok: false; response: Response }

export async function requireSession(
  kv: KVNamespace,
  request: Request
): Promise<RequireSessionResult> {
  const session = await readSessionFromRequest(kv, request)
  if (session === null) {
    return {
      ok: false,
      // no-store: an auth refusal must never be cached by a shared cache.
      response: jsonResponse({ error: 'authentication required' }, 401, {
        'Cache-Control': 'no-store',
      }),
    }
  }
  return { ok: true, session }
}
