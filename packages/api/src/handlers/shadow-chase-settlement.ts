import { captureSettlementEvent } from '../../../companion-memory/src/capture'
import type { CompanionDb } from '../../../companion-memory/src/db'
import type { SettlementCaptureInput } from '../../../companion-memory/src/types'
import { requireSession } from '../auth/require-session'

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
  runId: string
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
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'runId', 'outcome', 'durationTicks'])) {
    return false
  }
  return (
    value.version === 1 &&
    typeof value.runId === 'string' &&
    value.runId.length === 36 &&
    UUID_PATTERN.test(value.runId) &&
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

/** Stable source identity. The length prefix prevents delimiter ambiguity. */
export function settlementIdFor(gameId: string, userId: string, runId: string): string {
  return `${gameId}:${userId.length}:${userId}:${runId}`
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

  let required: Awaited<ReturnType<typeof requireSession>>
  try {
    required = await requireSession(env.AUTH, request)
  } catch {
    return jsonResponse({ error: 'settlement service failed' }, 500)
  }
  if (!required.ok) return required.response

  const body = parsed.value
  const occurredAt = (options.now ?? (() => new Date().toISOString()))()
  const settlementId = settlementIdFor(SHADOW_CHASE_GAME_ID, required.session.user_id, body.runId)
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
      await capture(env.COMPANION_DB as CompanionDb, captureInput)
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
  return jsonResponse({ accepted: true }, 202)
}
