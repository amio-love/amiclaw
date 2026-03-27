import type {
  ScoreSubmission,
  LeaderboardEntry,
  ScoreSubmissionResponse,
} from '../../../../shared/leaderboard-types'
import { validateSubmission, sanitizeNickname } from '../validation'

const RATE_LIMIT_MS = 10_000
const MAX_ENTRIES = 100
const KV_TTL_SECONDS = 48 * 60 * 60  // 48 hours

export async function handlePostScore(
  request: Request,
  kv: KVNamespace,
): Promise<Response> {
  let body: ScoreSubmission
  try {
    body = await request.json() as ScoreSubmission
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const validation = validateSubmission(body)
  if (!validation.ok) {
    return jsonResponse({ error: validation.error }, 422)
  }

  // Rate limiting: 1 submission per 10 seconds per device
  const rateLimitKey = `ratelimit:${body.device_id}`
  const lastSubmit = await kv.get(rateLimitKey, 'json') as { ts: number } | null
  if (lastSubmit && Date.now() - lastSubmit.ts < RATE_LIMIT_MS) {
    return jsonResponse({ error: 'Rate limit: wait 10 seconds between submissions' }, 429)
  }
  await kv.put(rateLimitKey, JSON.stringify({ ts: Date.now() }), { expirationTtl: 60 })

  // Update personal best for today
  const bestKey = `best:${body.date}:${body.device_id}`
  const currentBest = await kv.get(bestKey, 'json') as { time_ms: number } | null
  if (!currentBest || body.time_ms < currentBest.time_ms) {
    await kv.put(bestKey, JSON.stringify({ time_ms: body.time_ms }), {
      expirationTtl: KV_TTL_SECONDS,
    })
  }

  // Read-modify-write leaderboard
  const leaderboardKey = `leaderboard:${body.date}`
  const existing = (await kv.get(leaderboardKey, 'json') as LeaderboardEntry[] | null) ?? []

  const newEntry: LeaderboardEntry = {
    rank: 0,  // assigned below after sort
    nickname: sanitizeNickname(body.nickname),
    time_ms: body.time_ms,
    attempt_number: body.attempt_number,
    ai_tool: body.ai_tool,
  }

  const updated = [...existing, newEntry]
    .sort((a, b) => a.time_ms - b.time_ms)
    .slice(0, MAX_ENTRIES)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }))

  await kv.put(leaderboardKey, JSON.stringify(updated), {
    expirationTtl: KV_TTL_SECONDS,
  })

  const rank = updated.findIndex(
    e => e.nickname === newEntry.nickname && e.time_ms === newEntry.time_ms,
  ) + 1

  const response: ScoreSubmissionResponse = {
    rank: rank > 0 ? rank : updated.length + 1,
    total_players: updated.length,
  }
  return jsonResponse(response, 200)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
