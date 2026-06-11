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
