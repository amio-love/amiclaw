import { getTodayString } from '../../../../shared/date'
import type { WinReward } from '../../../../shared/reward-types'
import { captureSettlementEvent } from '../../../companion-memory/src/capture'
import type { CompanionDb } from '../../../companion-memory/src/db'
import { ASSET_TYPE_STARBURST } from '../../../companion-memory/src/economy'
import { settlementIdFor } from '../../../companion-memory/src/idempotency'
import { creditWinReward } from '../../../companion-memory/src/ledger'
import type { SettlementCaptureInput } from '../../../companion-memory/src/types'
import { requireSession } from '../auth/require-session'

// The stable (game, user, run) identity is owned by companion-memory's
// idempotency module — the win-reward `win:{settlementId}` key derives from the
// same helper, so the settlement capture id and the reward key can never drift.
// Re-exported here to keep this handler's module surface (and its callers) stable
// after the convergence (design §9 PR-3 CONVERGENCE).
export { settlementIdFor } from '../../../companion-memory/src/idempotency'

export const SHADOW_CHASE_GAME_ID = 'shadow-chase'
export const MAX_SETTLEMENT_REQUEST_BYTES = 2_048

const RUN_CAP_TICKS = 1_200
const TICK_SECONDS = 0.25
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ShadowChaseSettlementEnv {
  AUTH?: KVNamespace
  COMPANION_DB?: CompanionDb
}

export interface SettlementScheduler {
  schedule(promise: Promise<unknown>): void
}

export interface ShadowChaseSettlementLog {
  event: 'shadow-chase-settlement'
  outcome: 'capture-failed'
  gameId: typeof SHADOW_CHASE_GAME_ID
  runRef: string
}

export interface ShadowChaseSettlementOptions {
  scheduler?: SettlementScheduler
  capture?: (db: CompanionDb, input: SettlementCaptureInput) => Promise<unknown>
  now?: () => string
  logger?: (entry: ShadowChaseSettlementLog) => void
}

interface SettlementBody {
  version: 1
  // Seed-derived deterministic run id — persisted as game-run provenance only.
  runId: string
  // Per-attempt settlement identity (fresh UUID per attempt) — the idempotency
  // component for both the win reward and the settlement capture.
  attemptId: string
  outcome: 'win' | 'loss' | 'timeout'
  durationTicks: number
}

type BodyReadResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validateBody(value: unknown): value is SettlementBody {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['version', 'runId', 'attemptId', 'outcome', 'durationTicks'])
  ) {
    return false
  }
  return (
    value.version === 1 &&
    typeof value.runId === 'string' &&
    value.runId.length === 36 &&
    UUID_PATTERN.test(value.runId) &&
    typeof value.attemptId === 'string' &&
    value.attemptId.length === 36 &&
    UUID_PATTERN.test(value.attemptId) &&
    (value.outcome === 'win' || value.outcome === 'loss' || value.outcome === 'timeout') &&
    Number.isSafeInteger(value.durationTicks) &&
    (value.durationTicks as number) >= 1 &&
    (value.durationTicks as number) <= RUN_CAP_TICKS
  )
}

async function readBoundedJson(request: Request): Promise<BodyReadResult> {
  const declared = request.headers.get('Content-Length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > MAX_SETTLEMENT_REQUEST_BYTES) {
      return { ok: false, status: 413 }
    }
  }
  if (request.body === null) return { ok: false, status: 400 }
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_SETTLEMENT_REQUEST_BYTES) return { ok: false, status: 413 }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch {
    return { ok: false, status: 400 }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // Body already closed or errored.
    }
    reader.releaseLock()
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400 }
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function defaultLogger(entry: ShadowChaseSettlementLog): void {
  console.error(JSON.stringify(entry))
}

export async function handlePostShadowChaseSettlement(
  request: Request,
  env: ShadowChaseSettlementEnv,
  options: ShadowChaseSettlementOptions = {}
): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405)
  const url = new URL(request.url)
  if (request.headers.get('Origin') !== url.origin) {
    return jsonResponse({ error: 'forbidden origin' }, 403)
  }
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return jsonResponse({ error: 'application/json required' }, 415)
  }
  const parsed = await readBoundedJson(request)
  if (!parsed.ok) {
    return jsonResponse(
      { error: parsed.status === 413 ? 'request too large' : 'invalid JSON' },
      parsed.status
    )
  }
  if (!validateBody(parsed.value)) {
    return jsonResponse({ error: 'invalid settlement' }, 422)
  }
  if (!env.AUTH || !env.COMPANION_DB || !options.scheduler) {
    return jsonResponse({ error: 'settlement service unavailable' }, 503)
  }
  const companionDb = env.COMPANION_DB

  let required: Awaited<ReturnType<typeof requireSession>>
  try {
    required = await requireSession(env.AUTH, request)
  } catch {
    return jsonResponse({ error: 'settlement service failed' }, 500)
  }
  if (!required.ok) return required.response

  const body = parsed.value
  const occurredAt = (options.now ?? (() => new Date().toISOString()))()
  // The settlement identity keys on the per-attempt `attemptId`, never the
  // seed-derived `runId` (which repeats across attempts of the same seed). Both
  // the capture event id (settlementEventId) and the win-reward key
  // (winSourceKey) derive from this settlementId, so they dedup on the same
  // per-attempt basis. `runId` is retained only as game-run provenance.
  const settlementId = settlementIdFor(
    SHADOW_CHASE_GAME_ID,
    required.session.user_id,
    body.attemptId
  )
  const captureInput: SettlementCaptureInput = {
    settlementId,
    userId: required.session.user_id,
    gameId: SHADOW_CHASE_GAME_ID,
    gameRunId: body.runId,
    outcome: body.outcome,
    durationSeconds: body.durationTicks * TICK_SECONDS,
    occurredAt,
  }
  const capture = options.capture ?? captureSettlementEvent
  const logger = options.logger ?? defaultLogger

  // Gate invocation until waitUntil registration succeeds. If registration
  // throws synchronously, release the promise as a no-op and return 503 without
  // touching D1.
  let release!: () => void
  let registered = false
  const registrationGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const background = registrationGate
    .then(async () => {
      if (!registered) return
      await capture(companionDb, captureInput)
    })
    .catch(() => {
      logger({
        event: 'shadow-chase-settlement',
        outcome: 'capture-failed',
        gameId: SHADOW_CHASE_GAME_ID,
        // A UUID run reference is sufficient for correlation and contains no
        // session-derived owner. Never log settlementId: it embeds userId.
        runRef: body.runId,
      })
    })
  try {
    options.scheduler.schedule(background)
  } catch {
    release()
    return jsonResponse({ error: 'settlement service unavailable' }, 503)
  }
  registered = true
  release()

  // Only a WIN credits the +5 win reward, synchronously (awaited) before the
  // response so the exact reward rides back on the 202 (design §3). Memory
  // capture stays backgrounded above via the scheduler. creditWinReward is
  // internally fail-open — an 'error' status omits the reward field so the
  // settlement always succeeds. The win-reward key derives from the same
  // per-attempt `attemptId` as the capture id, matching it byte-for-byte.
  let reward: WinReward | undefined
  if (body.outcome === 'win') {
    const result = await creditWinReward(companionDb, {
      userId: required.session.user_id,
      gameId: SHADOW_CHASE_GAME_ID,
      runId: body.attemptId,
      today: getTodayString(new Date(occurredAt)),
      deps: { now: () => occurredAt, newId: () => crypto.randomUUID() },
    })
    if (result.status !== 'error') {
      reward = {
        asset_type: ASSET_TYPE_STARBURST,
        amount: result.amount,
        status: result.status,
        balance: result.balance,
      }
    }
  }
  return jsonResponse({ accepted: true, ...(reward ? { reward } : {}) }, 202)
}
