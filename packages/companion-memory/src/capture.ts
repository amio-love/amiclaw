/**
 * Capture entry — the write-path inbox (L2 §Mechanism Variant 1).
 *
 * Two capture inputs become `capture_event` rows: the `endSession`
 * `sessionSummary` (handed off by the platform-ai boundary, fire-and-forget)
 * and the signed-in player's game settlement event. Both inserts are keyed by
 * a stable source-derived `event_id` and are `ON CONFLICT DO NOTHING`, so the
 * capture entry itself is the first idempotency gate: re-delivering the same
 * source never enqueues a second consolidation.
 *
 * An anonymous summary (no `userId`) is dropped here — anonymous sessions
 * must never produce memories (mode① stays memory-free).
 */

import type { CompanionDb } from './db'
import type { DomainDeps } from './deps'
import { defaultDeps } from './deps'
import { settlementEventId, summaryEventId } from './idempotency'
import type { SessionSummaryCaptureInput, SettlementCaptureInput } from './types'

export interface CaptureResult {
  /** True when a new capture_event row was written (false on replay / drop). */
  captured: boolean
  /** Why nothing was captured, when applicable. */
  reason?: 'no-user' | 'duplicate'
  eventId?: string
}

export async function captureSessionSummary(
  db: CompanionDb,
  input: SessionSummaryCaptureInput,
  deps: DomainDeps = defaultDeps
): Promise<CaptureResult> {
  if (!input.userId) return { captured: false, reason: 'no-user' }
  const eventId = summaryEventId(input)
  const occurredAt = input.occurredAt ?? deps.now()
  const result = await db
    .prepare(
      `INSERT INTO capture_event (event_id, user_id, kind, game_id, game_run_id, payload, occurred_at, created_at)
       VALUES (?, ?, 'session_summary', ?, ?, ?, ?, ?)
       ON CONFLICT (event_id) DO NOTHING`
    )
    .bind(
      eventId,
      input.userId,
      input.gameId,
      input.gameRunId ?? null,
      JSON.stringify(input),
      occurredAt,
      deps.now()
    )
    .run()
  if (result.meta.changes === 0) return { captured: false, reason: 'duplicate', eventId }
  return { captured: true, eventId }
}

export async function captureSettlementEvent(
  db: CompanionDb,
  input: SettlementCaptureInput,
  deps: DomainDeps = defaultDeps
): Promise<CaptureResult> {
  if (!input.userId) return { captured: false, reason: 'no-user' }
  const eventId = settlementEventId(input.settlementId)
  const occurredAt = input.occurredAt ?? deps.now()
  const result = await db
    .prepare(
      `INSERT INTO capture_event (event_id, user_id, kind, game_id, game_run_id, payload, occurred_at, created_at)
       VALUES (?, ?, 'settlement', ?, ?, ?, ?, ?)
       ON CONFLICT (event_id) DO NOTHING`
    )
    .bind(
      eventId,
      input.userId,
      input.gameId,
      input.gameRunId ?? null,
      JSON.stringify(input),
      occurredAt,
      deps.now()
    )
    .run()
  if (result.meta.changes === 0) return { captured: false, reason: 'duplicate', eventId }
  return { captured: true, eventId }
}
