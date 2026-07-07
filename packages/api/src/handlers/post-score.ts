import {
  LEADERBOARD_RETENTION_DAYS,
  type ScoreSubmission,
  type ScoreSubmissionResponse,
} from '../../../../shared/leaderboard-types'
import { computeBestRecord, type BestRecord } from '../../../../shared/personal-best'
import { captureSettlementEvent } from '../../../companion-memory/src/capture'
import type { CompanionDb } from '../../../companion-memory/src/db'
import { readSessionFromRequest } from '../auth/session'
import { dedupeStoredEntries, type StoredEntry } from '../leaderboard-entries'
import {
  MAX_AI_MODEL_LEN,
  MAX_AI_TOOL_LEN,
  sanitizeLeaderboardText,
  sanitizeNickname,
  validateSubmission,
} from '../validation'

const RATE_LIMIT_MS = 10_000
const MAX_ENTRIES = 100
// Derived from the shared retention contract (2 days -> 48h) so the frontend
// date-switcher window and this TTL cannot drift apart.
const KV_TTL_SECONDS = LEADERBOARD_RETENTION_DAYS * 24 * 60 * 60

export interface PostScoreOptions {
  auth?: KVNamespace
  companionDb?: CompanionDb
  now?: () => string
}

export async function handlePostScore(
  request: Request,
  kv: KVNamespace,
  options: PostScoreOptions = {}
): Promise<Response> {
  let body: ScoreSubmission
  try {
    body = (await request.json()) as ScoreSubmission
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const validation = validateSubmission(body)
  if (!validation.ok) {
    return jsonResponse({ error: validation.error }, 422)
  }

  // Rate limiting: 1 submission per 10 seconds per device
  const rateLimitKey = `ratelimit:${body.device_id}`
  const lastSubmit = (await kv.get(rateLimitKey, 'json')) as { ts: number } | null
  if (lastSubmit && Date.now() - lastSubmit.ts < RATE_LIMIT_MS) {
    return jsonResponse({ error: 'Rate limit: wait 10 seconds between submissions' }, 429)
  }
  await kv.put(rateLimitKey, JSON.stringify({ ts: Date.now() }), { expirationTtl: 60 })

  // Update personal best for today.
  // KV value shape evolved from { time_ms } → { time_ms, attempt_number }.
  // Legacy records may still be missing attempt_number; treat that as graceful
  // and only emit personal_best_attempt in the response when it's present.
  const bestKey = `best:${body.date}:${body.device_id}`
  const currentBest = (await kv.get(bestKey, 'json')) as BestRecord | null
  const { record: bestRecord, isNewBest } = computeBestRecord(currentBest, body)
  if (isNewBest) {
    await kv.put(bestKey, JSON.stringify(bestRecord), {
      expirationTtl: KV_TTL_SECONDS,
    })
  }

  // Read-modify-write leaderboard
  const leaderboardKey = `leaderboard:${body.date}`
  const existing = ((await kv.get(leaderboardKey, 'json')) as StoredEntry[] | null) ?? []

  const newEntry: StoredEntry = {
    rank: 0, // assigned below after sort
    nickname: sanitizeNickname(body.nickname),
    time_ms: body.time_ms,
    attempt_number: body.attempt_number,
    ai_tool: sanitizeLeaderboardText(body.ai_tool, MAX_AI_TOOL_LEN),
    device_id: body.device_id,
    ...(body.run_id ? { run_id: body.run_id } : {}),
  }
  const aiModel = body.ai_model
    ? sanitizeLeaderboardText(body.ai_model, MAX_AI_MODEL_LEN)
    : undefined
  if (aiModel) newEntry.ai_model = aiModel

  // Idempotency: when the submission carries a run_id, remove any existing
  // entry with the same run_id before appending. This makes a double-POST of
  // the same run (e.g. page refresh or KV race) produce exactly one row.
  const base = body.run_id ? existing.filter((e) => e.run_id !== body.run_id) : existing

  // One row per player per day: dedupeStoredEntries keeps each player's best
  // time (keyed on device_id, nickname fallback for legacy rows), sorts, and
  // reassigns ranks. A resubmission slower than the player's existing best is
  // therefore dropped here — the board always shows the day's best run.
  const updated = dedupeStoredEntries([...base, newEntry]).slice(0, MAX_ENTRIES)

  await kv.put(leaderboardKey, JSON.stringify(updated), {
    expirationTtl: KV_TTL_SECONDS,
  })

  // The player's board rank is their kept (best) row — not necessarily the
  // run just submitted. Fall back to the legacy nickname+time match for rows
  // that predate device_id storage.
  let rank = updated.findIndex((e) => e.device_id === body.device_id) + 1
  if (rank === 0) {
    rank =
      updated.findIndex((e) => e.nickname === newEntry.nickname && e.time_ms === newEntry.time_ms) +
      1
  }

  const response: ScoreSubmissionResponse = {
    rank: rank > 0 ? rank : updated.length + 1,
    total_players: updated.length,
    personal_best_ms: bestRecord.time_ms,
    ...(bestRecord.attempt_number !== undefined
      ? { personal_best_attempt: bestRecord.attempt_number }
      : {}),
  }
  await captureAuthenticatedSettlement(request, body, options)
  return jsonResponse(response, 200)
}

async function captureAuthenticatedSettlement(
  request: Request,
  body: ScoreSubmission,
  options: PostScoreOptions
): Promise<void> {
  if (!body.run_id || !options.auth || !options.companionDb) return

  try {
    const session = await readSessionFromRequest(options.auth, request)
    if (session === null) return
    const now = options.now ?? (() => new Date().toISOString())
    await captureSettlementEvent(
      options.companionDb,
      {
        settlementId: body.run_id,
        userId: session.user_id,
        gameId: 'bombsquad',
        gameRunId: body.run_id,
        outcome: 'win',
        durationSeconds: body.time_ms / 1000,
        occurredAt: now(),
      },
      { now, newId: () => crypto.randomUUID() }
    )
  } catch {
    console.warn('score settlement capture failed')
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
