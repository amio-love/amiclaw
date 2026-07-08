import type { LeaderboardEntry, LeaderboardResponse } from '../../../../shared/leaderboard-types'
import { dedupeStoredEntries, type StoredEntry } from '../leaderboard-entries'
import { MIN_GAME_TIME_MS } from '../validation'

export async function handleGetLeaderboard(request: Request, kv: KVNamespace): Promise<Response> {
  const url = new URL(request.url)
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: 'Invalid date format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const raw = ((await kv.get(`leaderboard:${date}`, 'json')) as StoredEntry[] | null) ?? []
  // Integrity sweep (F2): drop any row below the plausibility floor at read time
  // — the same floor the write gate enforces (MIN_GAME_TIME_MS). Rows written
  // before the floor shipped (e.g. legacy sub-60s entries still inside the 48h
  // KV TTL) would otherwise headline the board and poison the homepage
  // 「最快拆弹 / 日榜首」 stat (which reads entries[0]). This is a display filter,
  // not a delete — the data stays in KV and ages out on its own, so the sweep is
  // reversible and also catches any other legacy junk. Filtered BEFORE dedup so
  // a player whose only implausible row is faster than a legit one still surfaces
  // via their plausible row (dedup keeps the fastest surviving row per player).
  const plausible = raw.filter((e) => e.time_ms >= MIN_GAME_TIME_MS)
  // Read-time dedup: rows written before write-time per-player dedup shipped
  // can still contain duplicates (same player, multiple runs). Collapsing at
  // read keeps historical boards honest until they age out of the 48h KV TTL.
  // Then strip the internal keys — run_id (per-run idempotency) and device_id
  // (per-player dedup) are backend keys, not part of the public contract.
  const entries: LeaderboardEntry[] = dedupeStoredEntries(plausible).map((e) => {
    const entry = { ...e } as Partial<StoredEntry>
    delete entry.run_id
    delete entry.device_id
    return entry as LeaderboardEntry
  })

  const response: LeaderboardResponse = { date, entries }
  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  })
}
