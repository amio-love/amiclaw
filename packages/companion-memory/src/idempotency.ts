/**
 * Source-derived idempotency keys for the async write path.
 *
 * Every capture event has a stable `event_id` derived from its source (the L2
 * invariant "every capture event must carry a stable event_id / source_ref",
 * arch-component-companion-memory §Mechanism Variant 1); every row the
 * consolidation job writes carries a unique key derived from that event id.
 * Replaying the same source therefore re-derives the same keys, and every
 * insert is `ON CONFLICT DO NOTHING` — zero duplicate episodes, zero duplicate
 * ledger credits, no matter how many times an event is retried.
 */

/**
 * Stable capture event id for one session summary. Uniqueness rests on the
 * platform-ai premise that `sessionId` is minted fresh per session assembly
 * (`crypto.randomUUID()` in `assembleSession` — see
 * `AssembledSession.sessionId`), NEVER a Durable Object id: the same-named
 * resident DO is reused across `clearSession()` + re-`create`, so a
 * DO-derived id would make a second run's summary collide with the first's
 * and be dropped as a duplicate. With a per-run id, replaying one run's
 * summary re-derives the same key (dedup) while distinct runs always derive
 * distinct keys (no cross-run swallowing).
 */
export function summaryEventId(summary: { sessionId: string }): string {
  return `session-summary:${summary.sessionId}`
}

/** Stable capture event id for one settlement event. */
export function settlementEventId(settlementId: string): string {
  return `settlement:${settlementId}`
}

/** Unique key for the Nth episode distilled from one capture event. */
export function episodeSourceKey(eventId: string, ordinal: number): string {
  return `${eventId}#${ordinal}`
}

/** Unique key for the Nth claim distilled from one capture event. */
export function claimSourceKey(eventId: string, ordinal: number): string {
  return `${eventId}#claim#${ordinal}`
}

/** Unique key for the Nth asset grant carried by one capture event. */
export function assetSourceKey(eventId: string, ordinal: number): string {
  return `${eventId}#asset#${ordinal}`
}

/** Unique key for the claim created by correcting `originalClaimId`. */
export function correctionSourceKey(originalClaimId: string): string {
  return `correction:${originalClaimId}`
}

// --- Reward-economy ledger keys (L2 design §1 idempotency scheme) -------------
//
// Every reward/deduct row on `asset_entry` carries a source-derived UNIQUE key
// and is written `ON CONFLICT (source_key) DO NOTHING`, so a replayed reward or
// a double-fired session teardown is a row-level no-op. Per-row display `kind`
// is derived from the key prefix (`win:` / `checkin:` / `welcome:` / `session:`),
// never stored — see `ledger.ts`.

/**
 * Stable settlement identity for one (game, user, run). The `userId.length`
 * prefix prevents delimiter ambiguity when userId contains a colon.
 *
 * This MUST stay byte-identical to the `settlementIdFor` in
 * `packages/api/src/handlers/shadow-chase-settlement.ts` — the settlement
 * handlers and the win-reward key must derive the same id for the same run.
 * The wiring PR (design §9 PR-3) converges the api handlers onto this copy and
 * deletes the local one; until then the two definitions are kept in lockstep.
 */
export function settlementIdFor(gameId: string, userId: string, runId: string): string {
  return `${gameId}:${userId.length}:${userId}:${runId}`
}

/** Unique key for one game win's reward. Anchored per (game, user, run). */
export function winSourceKey(gameId: string, userId: string, runId: string): string {
  return `win:${settlementIdFor(gameId, userId, runId)}`
}

/** Unique key for one user's check-in on one UTC day (`YYYY-MM-DD`). */
export function checkinSourceKey(userId: string, utcDate: string): string {
  return `checkin:${userId}:${utcDate}`
}

/** Unique key for one user's once-ever welcome grant. */
export function welcomeSourceKey(userId: string): string {
  return `welcome:${userId}`
}

/** Unique key for one voice session's single negative deduct row. */
export function sessionDeductSourceKey(sessionId: string): string {
  return `session:${sessionId}`
}
