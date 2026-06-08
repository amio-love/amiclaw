import type {
  ScoreSubmission,
  ScoreSubmissionResponse,
  LeaderboardResponse,
} from '@shared/leaderboard-types'
import { API_BASE } from '@shared/api-base'

/**
 * Outcome of a score submission, discriminated on `ok` so callers can tell a
 * server-side validation rejection apart from a network failure. A `rejected`
 * result means the request reached the server and was refused (e.g. 422 from
 * `validateSubmission`, 429 rate limit); the player's run is fine and the copy
 * should NOT imply they are offline. A `network` result means the request never
 * completed (fetch threw) or its body could not be parsed — that is the only
 * case where "可能离线" is accurate.
 */
export type SubmitScoreResult =
  | { ok: true; data: ScoreSubmissionResponse }
  | { ok: false; kind: 'network' }
  | { ok: false; kind: 'rejected'; status: number; error?: string }

export async function submitScore(submission: ScoreSubmission): Promise<SubmitScoreResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/leaderboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    })
  } catch {
    return { ok: false, kind: 'network' } // request never completed
  }

  if (!res.ok) {
    // Server reached and refused. Surface its error message when present so the
    // UI can show a real reason instead of an "offline" guess.
    let error: string | undefined
    try {
      const body = (await res.json()) as { error?: string }
      error = typeof body.error === 'string' ? body.error : undefined
    } catch {
      /* body absent or not JSON — leave error undefined */
    }
    return { ok: false, kind: 'rejected', status: res.status, error }
  }

  try {
    const data = (await res.json()) as ScoreSubmissionResponse
    return { ok: true, data }
  } catch {
    // 2xx but the success body did not parse — treat as a network-class failure.
    return { ok: false, kind: 'network' }
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
