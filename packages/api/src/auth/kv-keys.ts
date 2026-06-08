/**
 * Key-space helpers for the `AUTH` KV namespace.
 *
 * SSOT for the auth key layout — every KV read/write in the auth handlers
 * goes through one of these builders so the prefixes are defined once and the
 * namespace stays cleanly partitioned from `LEADERBOARD` (see
 * arch-component-auth-session §与 sibling component 边界):
 *
 *   magiclink:<sha256>          one-time token hash      (TTL ≤ 15 min)
 *   session:<id>                opaque session record    (TTL = session life)
 *   audit:<event>:<ts>:<rand>   append-only audit log    (TTL = audit retention)
 *   ratelimit:email:<email>     per-email send counter   (TTL = send window)
 *   ratelimit:verify:global     global verify counter    (TTL = verify window)
 */

export function magicLinkKey(tokenHash: string): string {
  return `magiclink:${tokenHash}`
}

export function sessionKey(sessionId: string): string {
  return `session:${sessionId}`
}

/**
 * Audit-log key. Uniqueness comes from `<event>:<isoTimestamp>:<rand>`, so two
 * events of the same kind in the same millisecond never collide. KV has no
 * append; one event = one key.
 */
export function auditKey(event: string, isoTimestamp: string, rand: string): string {
  return `audit:${event}:${isoTimestamp}:${rand}`
}

/** Per-email magic-link send counter (invariant ③ — per-email send cap). */
export function rateLimitEmailKey(email: string): string {
  return `ratelimit:email:${email}`
}

/** Global verify-endpoint counter (invariant ③ — global verify cap). */
export function rateLimitVerifyGlobalKey(): string {
  return 'ratelimit:verify:global'
}
