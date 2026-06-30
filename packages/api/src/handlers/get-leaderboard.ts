import type { LeaderboardEntry, LeaderboardResponse } from '../../../../shared/leaderboard-types'

// Internal KV shape includes the dedup key; it must be stripped before the
// public GET response so run_id is never exposed to leaderboard readers.
type StoredEntry = LeaderboardEntry & { run_id?: string }

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
  // Strip the internal run_id from every entry — it is a backend dedup key,
  // not part of the public leaderboard contract.
  const entries: LeaderboardEntry[] = raw.map((e) => {
    const entry = { ...e } as Partial<StoredEntry>
    delete entry.run_id
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
