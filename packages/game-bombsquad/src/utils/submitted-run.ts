import type { ScoreSubmissionResponse } from '@shared/leaderboard-types'

/**
 * Records that a daily run's score is already on the leaderboard, keyed by the
 * stable `run_id`, together with the rank response the player was shown.
 *
 * Why this exists: the finished RESULT game state is persisted to
 * sessionStorage, so a reload (or a full-page nav to /leaderboard then Back on a
 * browser that skips bfcache) re-mounts ResultPage and re-fires its auto-submit.
 * The backend enforces one submission per 10s per device, so the re-POST is
 * rejected with 429 and the settlement would flip a just-earned rank into a
 * false「提交太频繁 / 提交失败」. Reading this marker back on mount lets the page
 * render the earned rank instead of re-POSTing, and lets a 429 for an
 * already-boarded run resolve as success.
 *
 * A single record (not one key per run) is kept and matched by `runId`, so a
 * stale marker from an earlier run in the same tab never restores for a
 * different run. Scoped to sessionStorage to mirror the RESULT state it pairs
 * with: both clear together when the tab closes.
 */
const SUBMITTED_RUN_KEY = 'bombsquad:submitted-run'

export interface SubmittedRun {
  runId: string
  response: ScoreSubmissionResponse
}

export function readSubmittedRun(): SubmittedRun | null {
  try {
    const raw = sessionStorage.getItem(SUBMITTED_RUN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SubmittedRun>
    const response = parsed.response
    if (
      typeof parsed.runId !== 'string' ||
      !response ||
      typeof response.rank !== 'number' ||
      typeof response.total_players !== 'number'
    ) {
      return null
    }
    return { runId: parsed.runId, response }
  } catch {
    return null
  }
}

export function writeSubmittedRun(runId: string, response: ScoreSubmissionResponse): void {
  try {
    sessionStorage.setItem(SUBMITTED_RUN_KEY, JSON.stringify({ runId, response }))
  } catch {
    /* storage full or blocked — the rank simply won't survive a reload */
  }
}
