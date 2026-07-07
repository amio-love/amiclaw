import type { LeaderboardEntry, LeaderboardResponse } from '../../../../shared/leaderboard-types'
import { dedupeStoredEntries, type StoredEntry } from '../leaderboard-entries'

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
  // Read-time dedup: rows written before write-time per-player dedup shipped
  // can still contain duplicates (same player, multiple runs). Collapsing at
  // read keeps historical boards honest until they age out of the 48h KV TTL.
  // Then strip the internal keys — run_id (per-run idempotency) and device_id
  // (per-player dedup) are backend keys, not part of the public contract.
  const entries: LeaderboardEntry[] = dedupeStoredEntries(raw).map((e) => {
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
