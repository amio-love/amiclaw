import type { LeaderboardEntry, LeaderboardResponse } from '@shared/leaderboard-types'

export async function handleGetLeaderboard(
  request: Request,
  kv: KVNamespace,
): Promise<Response> {
  const url = new URL(request.url)
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: 'Invalid date format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const entries = (await kv.get(`leaderboard:${date}`, 'json') as LeaderboardEntry[] | null) ?? []

  const response: LeaderboardResponse = { date, entries }
  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  })
}
