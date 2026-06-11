/**
 * Usage flush — persist one ended session's usage counters to the USAGE KV.
 *
 * This is the testable core of the DO's session-terminal metering flush
 * (`VoiceSessionDO.flushUsage` is a thin shell over `flushSessionUsage`),
 * extracted pure-ish so the key shape, record shape, and fail-open behavior
 * are unit-testable in Node without any DO harness. (The real `VoiceSessionDO`
 * is ALSO instantiable in tests via the `vi.mock('cloudflare:workers')`
 * production-class harness — see `session-do-usage-flush.test.ts`; this pure
 * core simply stays the cheapest place to pin the storage contract.)
 *
 * Storage contract (L2 §Mechanism Variant 4):
 *  - One write-once record per session: key `usage:{date}:{user_id}:{session_id}`
 *    where `date` is the UTC `YYYY-MM-DD` at flush time and `session_id` is the
 *    session's freshly minted UUID (see `session-assembly.ts`) — globally
 *    unique, so concurrent sessions never contend on a key and the read side
 *    aggregates by `list({ prefix }) + sum`. No read-modify-write counters
 *    (KV has no atomic increment; concurrent RMW loses updates).
 *  - Billing-grade data: no TTL.
 *  - FAIL-OPEN: a KV failure (or an absent binding in dev/demo) is logged and
 *    swallowed — metering must never throw into, block, or delay session
 *    teardown or the player-facing path. The accepted failure cost is
 *    undercount-only (the platform absorbs it); nothing here can over-meter.
 */

import type { UsageCounters } from './turn-pipeline'
import type { SttUsageSource } from './providers/types'

/**
 * Minimal structural view of the bound USAGE KV namespace — just the write the
 * flush needs. Narrower than the full `KVNamespace` lib type so the flush stays
 * testable with a plain object mock.
 */
export interface UsageKvWriter {
  put(key: string, value: string): Promise<void>
}

/** Snapshot of one ended session's metering state, captured before teardown. */
export interface SessionUsageSnapshot {
  sessionId: string
  userId: string
  gameId: string
  /** Completed player->AI turns (a turn canceled mid-flight never counts). */
  turnCount: number
  /** The session's accumulated usage counters. */
  usage: UsageCounters
  /** Aggregate STT metering provenance (see `SessionState.sttSource`). */
  sttSource: SttUsageSource
}

/** JSON value stored under the usage key. Identity lives in the key. */
export interface UsageRecord {
  gameId: string
  turnCount: number
  usage: UsageCounters
  sttSource: SttUsageSource
  /** ISO 8601 flush timestamp — provenance for audits and late-write triage. */
  flushedAt: string
}

/** Build the write-once usage key: `usage:{date}:{user_id}:{session_id}` (UTC date). */
export function usageKeyFor(flushedAt: Date, userId: string, sessionId: string): string {
  return `usage:${flushedAt.toISOString().slice(0, 10)}:${userId}:${sessionId}`
}

/** Build the stored JSON record from a session snapshot. */
export function buildUsageRecord(snapshot: SessionUsageSnapshot, flushedAt: Date): UsageRecord {
  return {
    gameId: snapshot.gameId,
    turnCount: snapshot.turnCount,
    usage: { ...snapshot.usage },
    sttSource: snapshot.sttSource,
    flushedAt: flushedAt.toISOString(),
  }
}

/**
 * Persist one session's usage snapshot to the USAGE KV. Never rejects:
 *  - `kv` undefined (dev/demo deploy without the binding) -> silent no-op;
 *  - KV `put` failure -> `console.error` and swallow.
 * The caller fires-and-forgets this from the session-terminal paths; the
 * exactly-once guard lives with the caller's session state (the flush is
 * called at most once per session), not here.
 */
export async function flushSessionUsage(
  kv: UsageKvWriter | undefined,
  snapshot: SessionUsageSnapshot,
  now: Date = new Date()
): Promise<void> {
  if (kv === undefined) return
  const key = usageKeyFor(now, snapshot.userId, snapshot.sessionId)
  try {
    await kv.put(key, JSON.stringify(buildUsageRecord(snapshot, now)))
  } catch (err) {
    // Fail-open: losing one metering record is an accepted undercount; failing
    // the session-close path over it is not.
    console.error(`platform-ai: usage flush failed for ${key}`, err)
  }
}
