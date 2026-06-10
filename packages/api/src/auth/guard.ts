/**
 * Session guard (Mechanism Variant 3 — cross-cutting verification).
 *
 * Contract: a request that CLAIMS a `user_id` must carry a valid session whose
 * `user_id` matches the claim. A request that claims no `user_id` is untouched
 * — this keeps the current anonymous device-UUID leaderboard flow working
 * unchanged (the guard is a no-op for it).
 *
 * `guardClaimedUserId` is body-agnostic: the caller extracts whatever
 * `user_id` the request claims (JSON body field, query param, header) and
 * passes it in, so this stays a pure function over (claim, session) and is
 * trivially unit-testable.
 */

import type { SessionRecord } from './session'
import { readSessionFromRequest } from './session'

export type GuardOutcome =
  | { ok: true; identity: SessionRecord | null }
  | { ok: false; status: 401; reason: string }

/**
 * Pure decision: given the `user_id` a request claims (or null/undefined if it
 * claims none) and the session resolved from its cookie (or null), decide
 * allow / reject.
 *
 *   - No claim                  → allow (anonymous flow; session may be null).
 *   - Claim + no session        → reject 401.
 *   - Claim + session mismatch  → reject 401 (can't act as another user).
 *   - Claim + matching session  → allow.
 */
export function decideGuard(
  claimedUserId: string | null | undefined,
  session: SessionRecord | null
): GuardOutcome {
  if (claimedUserId === null || claimedUserId === undefined || claimedUserId === '') {
    return { ok: true, identity: session }
  }
  if (!session) {
    return { ok: false, status: 401, reason: 'user_id claimed without a valid session' }
  }
  if (session.user_id !== claimedUserId) {
    return { ok: false, status: 401, reason: 'session does not match claimed user_id' }
  }
  return { ok: true, identity: session }
}

/**
 * Resolve the session from the request cookie, then apply `decideGuard`
 * against the claimed `user_id`. Convenience wrapper for handlers / middleware.
 */
export async function guardClaimedUserId(
  kv: KVNamespace,
  request: Request,
  claimedUserId: string | null | undefined
): Promise<GuardOutcome> {
  const session = await readSessionFromRequest(kv, request)
  return decideGuard(claimedUserId, session)
}
