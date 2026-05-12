import type { EventIngestionResponse, EventPayload } from '../../../../shared/event-types'
import { validateEvent } from '../validation'

const KV_TTL_SECONDS = 48 * 60 * 60 // 48 hours — mirrors leaderboard retention
const UNIQUE_SET_CAP = 10_000 // protect against KV value-size limit (25MB hard)

const UNIQUE_SET_EVENTS = new Set<EventPayload['event']>(['game_start', 'game_complete'])

function uniqueSetKey(date: string, event: EventPayload['event']): string {
  // `game_start` → unique_starts, `game_complete` → unique_completes.
  // Keep the naming aligned with the Anchored Intent vocabulary on the
  // task record.
  if (event === 'game_start') return `events:${date}:unique_starts`
  return `events:${date}:unique_completes`
}

export async function handlePostEvent(request: Request, kv: KVNamespace): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400)
  }

  const validation = validateEvent(body)
  if (!validation.ok) {
    return jsonResponse({ ok: false, error: validation.error ?? 'Invalid payload' }, 422)
  }

  // After validateEvent, `body` matches EventPayload shape.
  const payload = body as EventPayload

  // Date for KV keys derives from the client-emitted ISO timestamp rather
  // than `Date.now()` server-side. This avoids a date-boundary race for
  // events fired just before UTC midnight that the server processes just
  // after — the counter should belong to the day the event happened, not
  // the day the request landed.
  const date = payload.timestamp.slice(0, 10)

  // Counter: `events:{date}:{event_name}` → JSON `{ count: number }`.
  const counterKey = `events:${date}:${payload.event}`
  const existingCounter = (await kv.get(counterKey, 'json')) as { count: number } | null
  const nextCount = (existingCounter?.count ?? 0) + 1
  await kv.put(counterKey, JSON.stringify({ count: nextCount }), {
    expirationTtl: KV_TTL_SECONDS,
  })

  // Unique-device sets for game_start / game_complete only.
  // We store as JSON array (deduped, capped) — once cap is reached, further
  // device_ids for the day are dropped on the floor, which is acceptable for
  // a metric whose primary use is "estimate unique-player completion rate
  // within an order of magnitude." Counter remains exact regardless.
  if (UNIQUE_SET_EVENTS.has(payload.event)) {
    const setKey = uniqueSetKey(date, payload.event)
    const existingSet = ((await kv.get(setKey, 'json')) as string[] | null) ?? []
    if (!existingSet.includes(payload.device_id) && existingSet.length < UNIQUE_SET_CAP) {
      existingSet.push(payload.device_id)
      await kv.put(setKey, JSON.stringify(existingSet), {
        expirationTtl: KV_TTL_SECONDS,
      })
    }
  }

  const response: EventIngestionResponse = { ok: true }
  return jsonResponse(response, 200)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
