/**
 * `CompanionConsolidatorDO` — the alarm-driven consolidation trigger
 * (companion-memory L2 §Mechanism Variant 1; trigger selection: DO alarm).
 *
 * Why a DO alarm (over `waitUntil` / Queues): `waitUntil` is bounded by the
 * parent request's wall-clock lifetime and an LLM distillation can overrun
 * it; Cloudflare Queues would add a new platform dependency. A singleton DO
 * with `storage.setAlarm` reuses the repo's existing DO pattern, survives
 * eviction (alarms are durable), and retries for free by re-arming.
 *
 * Thin shell: the actual job body is `runConsolidation` from
 * @amiclaw/companion-memory (pure-ish, fully unit-tested in Node). This class
 * only (a) accepts capture hand-offs, (b) manages the alarm, (c) wires the
 * D1 binding + consolidation LLM from env.
 *
 *   POST /capture  body = SessionSummary (from `endSession`'s hand-off)
 *      -> capture row (idempotent) + ensure an alarm is armed.
 *   alarm()
 *      -> one `runConsolidation` pass; re-arm while events remain pending.
 *
 * Failure semantics: a missing D1 binding returns 503 / skips silently — the
 * memory layer is an enhancement, never a dependency of session teardown.
 */

import { DurableObject } from 'cloudflare:workers'
import { captureSessionSummary } from '../../companion-memory/src/capture'
import { runConsolidation } from '../../companion-memory/src/consolidate'
import type { CompanionDb } from '../../companion-memory/src/db'
import { captureInputFromSummary } from './companion-capture'
import type { SessionSummary } from './contract'
import { createConsolidationLlm, type ConsolidationLlmEnv } from './distill-llm'

/** Delay before a freshly captured event is consolidated. */
const CONSOLIDATION_DELAY_MS = 10_000
/** Re-arm delay while pending (retryable) events remain. */
const RETRY_DELAY_MS = 60_000

/** Env bindings the consolidator reads. All optional: absent = inert. */
export interface ConsolidatorEnv extends ConsolidationLlmEnv {
  COMPANION_DB?: CompanionDb
  [key: string]: unknown
}

export class CompanionConsolidatorDO extends DurableObject<ConsolidatorEnv> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/capture') {
      return new Response('not found', { status: 404 })
    }
    const db = this.env.COMPANION_DB
    if (db === undefined) {
      return new Response('companion db not bound', { status: 503 })
    }
    const summary = (await request.json()) as SessionSummary
    const result = await captureSessionSummary(db, captureInputFromSummary(summary))
    if (result.captured) {
      await this.ensureAlarm(CONSOLIDATION_DELAY_MS)
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  override async alarm(): Promise<void> {
    const db = this.env.COMPANION_DB
    if (db === undefined) return
    const llm = createConsolidationLlm(this.env)
    const outcome = await runConsolidation(db, llm)
    if (outcome.remaining > 0) {
      await this.ensureAlarm(RETRY_DELAY_MS)
    }
  }

  /** Arm the alarm if none is pending (an earlier alarm always wins). */
  private async ensureAlarm(delayMs: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm()
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + delayMs)
    }
  }
}
