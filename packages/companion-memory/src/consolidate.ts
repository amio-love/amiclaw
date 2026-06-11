/**
 * Asynchronous consolidation job (L2 §Mechanism Variant 1, write path).
 *
 * Driven by the platform-ai consolidator Durable Object's alarm; this module
 * is the pure(ish) job body so the whole pipeline is unit-testable in Node.
 *
 * Per pending capture event:
 *
 *   no companion           -> discard (memory exists only behind mode② setup)
 *   settlement event       -> deterministic fact episode + asset ledger rows
 *   summary, no highlights -> processed with no output (settlement facts only)
 *   summary + highlights   -> LLM distillation -> episodes + evidence-bearing
 *                             claims (claims gated by profile_enabled)
 *   summary, LLM missing   -> processed with no output (degraded)
 *   summary, LLM failed    -> attempts += 1, stays pending (bounded retries);
 *                             after MAX_ATTEMPTS, processed degraded
 *
 * Idempotency: every write carries a source-derived unique key and is
 * ON CONFLICT DO NOTHING; the capture_event row itself is the processed-event
 * record. Replaying a whole event (or crashing between writes and re-running)
 * produces zero duplicate episodes and zero duplicate ledger credits.
 *
 * Join semantics: a summary with a `game_run_id` pulls the SAME user's
 * settlement event for that run (pending or already processed) as distillation
 * context. Without a join key the two inputs consolidate independently.
 */

import type { CompanionDb, CompanionDbStatement } from './db'
import type { DomainDeps } from './deps'
import { defaultDeps } from './deps'
import {
  distillSettlementFacts,
  distillSummary,
  type DistillationResult,
  type DistillLlm,
} from './distill'
import { assetSourceKey, claimSourceKey, episodeSourceKey } from './idempotency'
import { getCompanion } from './store'
import type {
  CaptureEventRecord,
  CompanionRecord,
  SessionSummaryCaptureInput,
  SettlementCaptureInput,
} from './types'

/**
 * LLM-try budget for one summary event: exactly this many REAL attempts run
 * (each failure recorded in `attempts`, including the budget-exhausting last
 * one) before the event degrades to no-output processing.
 */
export const MAX_CONSOLIDATION_ATTEMPTS = 5

/** Max events pulled per job run (one alarm tick). */
export const BATCH_SIZE = 20

export interface ConsolidationOutcome {
  processed: number
  discarded: number
  /**
   * Events still pending after this run: in-batch retryable failures PLUS any
   * backlog beyond this run's batch (BATCH_SIZE). Non-zero tells the alarm
   * caller to re-arm — a burst larger than one batch must not strand its tail.
   */
  remaining: number
}

interface EpisodeWrite {
  title: string
  narrative: string
  salience: number
  sourceKind: 'session_summary' | 'settlement'
}

function insertEpisodeStatement(
  db: CompanionDb,
  event: CaptureEventRecord,
  episode: EpisodeWrite,
  ordinal: number,
  deps: DomainDeps
): CompanionDbStatement {
  return db
    .prepare(
      `INSERT INTO episode (id, user_id, occurred_at, game_id, title, narrative, source_kind, source_ref, source_key, salience, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_key) DO NOTHING`
    )
    .bind(
      deps.newId(),
      event.user_id,
      event.occurred_at,
      event.game_id,
      episode.title,
      episode.narrative,
      episode.sourceKind,
      event.event_id,
      episodeSourceKey(event.event_id, ordinal),
      episode.salience,
      deps.now()
    )
}

function markStatement(
  db: CompanionDb,
  eventId: string,
  status: 'processed' | 'discarded',
  deps: DomainDeps
): CompanionDbStatement {
  return db
    .prepare(`UPDATE capture_event SET status = ?, processed_at = ? WHERE event_id = ?`)
    .bind(status, deps.now(), eventId)
}

async function listPending(db: CompanionDb): Promise<CaptureEventRecord[]> {
  const { results } = await db
    .prepare(`SELECT * FROM capture_event WHERE status = 'pending' ORDER BY created_at LIMIT ?`)
    .bind(BATCH_SIZE)
    .all<CaptureEventRecord>()
  return results
}

/**
 * Events still pending AFTER a run — the re-arm signal. Cheap regardless of
 * how many processed rows the table accumulates: `idx_capture_status` makes
 * this an index-range scan over only the pending rows.
 */
async function countPending(db: CompanionDb): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM capture_event WHERE status = 'pending'`)
    .bind()
    .first<{ n: number }>()
  return row === null ? 0 : row.n
}

/** The same user+run's settlement event, as distillation context for a summary. */
async function findJoinedSettlement(
  db: CompanionDb,
  event: CaptureEventRecord
): Promise<SettlementCaptureInput | undefined> {
  if (event.game_run_id === null) return undefined
  const row = await db
    .prepare(
      `SELECT payload FROM capture_event
       WHERE user_id = ? AND kind = 'settlement' AND game_run_id = ? AND status != 'discarded'
       LIMIT 1`
    )
    .bind(event.user_id, event.game_run_id)
    .first<{ payload: string }>()
  if (row === null) return undefined
  return JSON.parse(row.payload) as SettlementCaptureInput
}

async function consolidateSettlement(
  db: CompanionDb,
  event: CaptureEventRecord,
  deps: DomainDeps
): Promise<void> {
  const payload = JSON.parse(event.payload) as SettlementCaptureInput
  const fact = distillSettlementFacts(payload)
  const statements: CompanionDbStatement[] = [
    insertEpisodeStatement(db, event, { ...fact, sourceKind: 'settlement' }, 0, deps),
  ]
  for (const [ordinal, asset] of (payload.assets ?? []).entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO asset_entry (id, user_id, asset_type, amount, source_product, source_ref, source_key, earned_at)
           VALUES (?, ?, ?, ?, 'amiclaw', ?, ?, ?)
           ON CONFLICT (source_key) DO NOTHING`
        )
        .bind(
          deps.newId(),
          event.user_id,
          asset.assetType,
          asset.amount,
          event.event_id,
          assetSourceKey(event.event_id, ordinal),
          event.occurred_at
        )
    )
  }
  statements.push(markStatement(db, event.event_id, 'processed', deps))
  await db.batch(statements)
}

async function writeDistillation(
  db: CompanionDb,
  event: CaptureEventRecord,
  result: DistillationResult,
  deps: DomainDeps
): Promise<void> {
  const statements: CompanionDbStatement[] = []
  // Replay semantics for every insert below: the ON CONFLICT target is the
  // source-derived `source_key` UNIQUE constraint, NOT the primary-key id. A
  // replayed batch re-derives the same source keys with FRESH ids; each insert
  // conflicts on its source_key and no-ops, so the FIRST run's rows (and ids)
  // survive and the graph never forks.
  result.episodes.forEach((episode, ordinal) => {
    statements.push(
      insertEpisodeStatement(
        db,
        event,
        { ...episode, sourceKind: 'session_summary' },
        ordinal,
        deps
      )
    )
  })
  result.claims.forEach((claim, ordinal) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO profile_claim (id, user_id, dimension, claim, status, source_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
           ON CONFLICT (source_key) DO NOTHING`
        )
        .bind(
          deps.newId(),
          event.user_id,
          claim.dimension,
          claim.claim,
          claimSourceKey(event.event_id, ordinal),
          deps.now(),
          deps.now()
        )
    )
    for (const episodeOrdinal of claim.evidenceEpisodeOrdinals) {
      // Resolve both endpoints via their source_keys, not freshly generated
      // ids: on a replay the inserts above are no-ops, and the evidence must
      // attach to the FIRST run's surviving claim/episode rows — the subquery
      // looks those up by source_key at execution time.
      statements.push(
        db
          .prepare(
            `INSERT INTO profile_claim_evidence (profile_claim_id, episode_id, created_at)
             SELECT pc.id, e.id, ?
             FROM profile_claim pc, episode e
             WHERE pc.source_key = ? AND e.source_key = ?
             ON CONFLICT (profile_claim_id, episode_id) DO NOTHING`
          )
          .bind(
            deps.now(),
            claimSourceKey(event.event_id, ordinal),
            episodeSourceKey(event.event_id, episodeOrdinal)
          )
      )
    }
  })
  statements.push(markStatement(db, event.event_id, 'processed', deps))
  await db.batch(statements)
}

/**
 * Whether claim production is allowed for this event, decided at PROCESSING
 * time (not capture time) so control-plane writes that land while the event
 * sits pending always win:
 *
 *  - `profile_enabled` is read fresh per run — disabling the profile fences
 *    every still-pending event immediately;
 *  - `profile_deleted_at` (the bulk-delete watermark) fences every event
 *    CAPTURED at-or-before the deletion instant — a pending or replayed event
 *    can never resurrect a profile the player erased. Events captured after
 *    the watermark produce claims normally (the player cleared history, not
 *    future profiling — that is what `profile_enabled` is for).
 *
 * The comparison is on `created_at` (server-assigned capture instant) against
 * the watermark; both come from the same `deps.now()` ISO-8601 UTC clock, so
 * lexicographic order is chronological. Ties go to the deletion (`<=` skips).
 * Episodes and asset entries are never gated here.
 */
function claimsAllowed(companion: CompanionRecord, event: CaptureEventRecord): boolean {
  if (companion.profile_enabled !== 1) return false
  return companion.profile_deleted_at === null || event.created_at > companion.profile_deleted_at
}

async function consolidateSummary(
  db: CompanionDb,
  event: CaptureEventRecord,
  llm: DistillLlm | null,
  claimsEnabled: boolean,
  deps: DomainDeps
): Promise<'processed' | 'retry'> {
  const payload = JSON.parse(event.payload) as SessionSummaryCaptureInput
  const highlights = payload.highlights ?? []

  // Degradations that need no LLM call: no highlights (nothing to distill —
  // settlement facts arrive on their own event) or no LLM configured.
  if (highlights.length === 0 || llm === null) {
    await db.batch([markStatement(db, event.event_id, 'processed', deps)])
    return 'processed'
  }

  let result: DistillationResult
  try {
    result = await distillSummary(llm, {
      gameId: event.game_id,
      highlights,
      turnCount: payload.turnCount,
      settlement: await findJoinedSettlement(db, event),
      profileEnabled: claimsEnabled,
    })
  } catch {
    // Count this REAL failed LLM try against the budget — including the
    // budget-exhausting final one, so `attempts` always equals the number of
    // tries that actually ran and MAX_CONSOLIDATION_ATTEMPTS means exactly
    // that many calls.
    const attempts = event.attempts + 1
    const recordAttempt = db
      .prepare(`UPDATE capture_event SET attempts = ? WHERE event_id = ?`)
      .bind(attempts, event.event_id)
    if (attempts >= MAX_CONSOLIDATION_ATTEMPTS) {
      // Retry budget exhausted: degrade to no-output processing rather than
      // retrying forever. Settlement facts were/will be consolidated from
      // their own event, so nothing factual is lost.
      await db.batch([recordAttempt, markStatement(db, event.event_id, 'processed', deps)])
      return 'processed'
    }
    await recordAttempt.run()
    return 'retry'
  }

  await writeDistillation(db, event, result, deps)
  return 'processed'
}

/**
 * Run one consolidation pass over pending capture events. Never throws for a
 * single event's failure — a bad event is retried (bounded) or degraded, and
 * the rest of the batch still processes. Returns counts so the caller (the
 * consolidator DO alarm) can decide whether to re-arm.
 *
 * `remaining` is counted from the table AFTER the pass, not from in-batch
 * bookkeeping: a backlog larger than BATCH_SIZE whose first batch fully
 * succeeds still reports remaining > 0, so the caller re-arms and the tail
 * drains instead of stranding until some future capture re-arms the alarm.
 */
export async function runConsolidation(
  db: CompanionDb,
  llm: DistillLlm | null,
  deps: DomainDeps = defaultDeps
): Promise<ConsolidationOutcome> {
  const pending = await listPending(db)
  const outcome: ConsolidationOutcome = { processed: 0, discarded: 0, remaining: 0 }

  for (const event of pending) {
    const companion = await getCompanion(db, event.user_id)
    if (companion === null) {
      await db.batch([markStatement(db, event.event_id, 'discarded', deps)])
      outcome.discarded += 1
      continue
    }
    if (event.kind === 'settlement') {
      await consolidateSettlement(db, event, deps)
      outcome.processed += 1
      continue
    }
    const status = await consolidateSummary(db, event, llm, claimsAllowed(companion, event), deps)
    if (status === 'processed') outcome.processed += 1
  }

  outcome.remaining = await countPending(db)
  return outcome
}
