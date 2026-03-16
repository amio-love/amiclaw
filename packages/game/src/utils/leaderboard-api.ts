import type {
  ScoreSubmission,
  ScoreSubmissionResponse,
  LeaderboardResponse,
} from '@shared/leaderboard-types'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://bombsquad.amio.fans'

export async function submitScore(
  submission: ScoreSubmission,
): Promise<ScoreSubmissionResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    })
    if (!res.ok) return null
    return res.json() as Promise<ScoreSubmissionResponse>
  } catch {
    return null // network failure — result page shows without rank
  }
}

export async function fetchLeaderboard(date?: string): Promise<LeaderboardResponse | null> {
  const query = date ? `?date=${encodeURIComponent(date)}` : ''
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard${query}`)
    if (!res.ok) return null
    return res.json() as Promise<LeaderboardResponse>
  } catch {
    return null
  }
}
