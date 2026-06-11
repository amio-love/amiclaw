/**
 * Companion-memory capture seam on the platform-ai side.
 *
 * Two pieces, both OFF the voice-turn hot path:
 *
 *  - `summarizeHighlights` — pure, deterministic transcript excerpt that
 *    populates `SessionSummary.highlights` at `endSession` (the consolidation
 *    LLM does the real summarization downstream; this just carries the raw
 *    material without an extra LLM call inside the session boundary).
 *  - `handOffSummaryCapture` — fire-and-forget delivery of the finished
 *    summary to the consolidator Durable Object (`POST /capture`), which owns
 *    the D1 write + alarm scheduling. Best-effort by contract: ANY failure is
 *    swallowed (logged) — consolidation failing must never affect the game
 *    result or the session end.
 */

import type { SessionSummaryCaptureInput } from '../../companion-memory/src/types'
import type { SessionSummary } from './contract'
import type { ChatMessage } from './providers/types'

/** Cap on how many trailing turns feed the highlights excerpt. */
const HIGHLIGHTS_MAX_MESSAGES = 20
/** Cap per highlight line, to bound the capture payload. */
const HIGHLIGHTS_MAX_CHARS = 200

/**
 * Deterministic conversation-highlights excerpt: the trailing
 * `HIGHLIGHTS_MAX_MESSAGES` history messages, each prefixed with its role and
 * truncated to `HIGHLIGHTS_MAX_CHARS`. Pure and total: empty history yields
 * an empty array (-> the capture side degrades to settlement facts only).
 */
export function summarizeHighlights(history: ChatMessage[]): string[] {
  return history.slice(-HIGHLIGHTS_MAX_MESSAGES).map((message) => {
    const text =
      message.content.length > HIGHLIGHTS_MAX_CHARS
        ? `${message.content.slice(0, HIGHLIGHTS_MAX_CHARS - 1)}…`
        : message.content
    return `${message.role}: ${text}`
  })
}

/** Map the additive `SessionSummary` fields onto the capture input shape. */
export function captureInputFromSummary(summary: SessionSummary): SessionSummaryCaptureInput {
  return {
    sessionId: summary.sessionId,
    gameId: summary.gameId,
    userId: summary.userId,
    turnCount: summary.turnCount,
    ...(summary.highlights !== undefined ? { highlights: summary.highlights } : {}),
    ...(summary.gameRunId !== undefined ? { gameRunId: summary.gameRunId } : {}),
    ...(summary.runInstanceId !== undefined ? { runInstanceId: summary.runInstanceId } : {}),
    ...(summary.occurredAt !== undefined ? { occurredAt: summary.occurredAt } : {}),
  }
}

/** Minimal structural view of the consolidator DO namespace binding. */
export interface ConsolidatorNamespace {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(request: Request): Promise<Response> }
}

/**
 * The consolidator is a SINGLETON DO: one well-known name, one alarm queue.
 * Consolidation volume is session-boundary-frequency (not per-turn), so a
 * single serialization point is plenty and keeps alarm scheduling trivial.
 */
export const CONSOLIDATOR_DO_NAME = 'companion-consolidator'

/**
 * Deliver one finished session summary to the consolidator DO. Best-effort:
 * never throws, never blocks the caller's teardown path — failures are
 * logged and dropped (the capture entry is idempotent, so a later settlement
 * event or retry can still consolidate independently).
 */
export async function handOffSummaryCapture(
  consolidator: ConsolidatorNamespace | undefined,
  summary: SessionSummary
): Promise<void> {
  if (consolidator === undefined) return
  try {
    const stub = consolidator.get(consolidator.idFromName(CONSOLIDATOR_DO_NAME))
    await stub.fetch(
      new Request('https://companion-consolidator/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summary),
      })
    )
  } catch (error) {
    console.warn('companion-capture: summary hand-off failed (memory is best-effort)', error)
  }
}
