/**
 * Append-only audit-log writer (invariant ⑦ — login / logout / verify events
 * written to `audit:*`).
 *
 * KV has no append, so each event is one key: `audit:<event>:<iso>:<rand>`.
 * The write is best-effort and never throws into the caller — an auth flow
 * must not fail because the audit write failed.
 */

import { auditKey } from './kv-keys'
import { AUDIT_TTL_SECONDS } from './config'

export type AuditEvent =
  | 'magic_link_request'
  | 'magic_link_verify'
  | 'google_oauth_callback'
  | 'oauth_failed'
  | 'login'
  | 'logout'
  | 'verify_failed'

export interface AuditDetails {
  /** Resolved user id, when known (verify success / logout). */
  user_id?: string
  /** Email involved, when known. */
  email?: string
  /** Free-form reason for failure events. */
  reason?: string
}

export async function writeAudit(
  kv: KVNamespace,
  event: AuditEvent,
  details: AuditDetails = {}
): Promise<void> {
  const isoTimestamp = new Date().toISOString()
  // Short random suffix to disambiguate same-millisecond events.
  const rand = crypto.randomUUID().slice(0, 8)
  const record = { event, ...details, timestamp: isoTimestamp }
  try {
    await kv.put(auditKey(event, isoTimestamp, rand), JSON.stringify(record), {
      expirationTtl: AUDIT_TTL_SECONDS,
    })
  } catch {
    // Audit is best-effort; never break the auth flow on a logging failure.
  }
}
