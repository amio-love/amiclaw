/**
 * Closing-recap dedup log.
 *
 * The settlement 复盘 must not double: a run that got the SPOKEN closing recap
 * (win-burst voice, `useVoiceSession.requestClosing`) must NOT also get the TEXT
 * post-game reaction (节拍 3) on the result page. GamePage records the run id the
 * moment it fires the recap; ResultPage reads it and suppresses beat-3 for that
 * run.
 *
 * The store is a single localStorage key holding the LAST run whose recap fired
 * — one run settles at a time, and the read happens on the immediately-following
 * result page for the same run, so a single-slot record is sufficient (and
 * self-cleaning: the next run overwrites it). A missing / unavailable store means
 * "no recap recorded" → beat-3 shows (the honest fallback), so the dedup can only
 * ever suppress a genuine double, never hide a reaction that should show.
 */

const CLOSING_RECAP_RUN_KEY = 'amio_closing_recap_run'

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Record that the spoken closing recap fired for `gameRunId`. */
export function recordClosingRecapFired(gameRunId: string): void {
  const store = storage()
  if (!store || gameRunId.length === 0) return
  try {
    store.setItem(CLOSING_RECAP_RUN_KEY, gameRunId)
  } catch {
    // Losing the record means at worst one extra (text) reaction — never fatal.
  }
}

/** Whether the spoken closing recap already fired for `gameRunId`. */
export function wasClosingRecapFired(gameRunId: string | null): boolean {
  if (gameRunId === null || gameRunId.length === 0) return false
  const store = storage()
  if (!store) return false
  try {
    return store.getItem(CLOSING_RECAP_RUN_KEY) === gameRunId
  } catch {
    return false
  }
}
