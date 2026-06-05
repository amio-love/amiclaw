import type { GameState } from './game-context'

/**
 * Session-scoped persistence for the in-flight game state.
 *
 * Why sessionStorage (not localStorage): the goal is protecting the player
 * from an accidental F5 / Cmd+R mid-run, not resuming a game days later.
 * sessionStorage survives refresh and cross-tab navigation within the same
 * tab, but a new tab or a browser restart produces a fresh game — which is
 * the right semantic for a 5-minute puzzle.
 *
 * Why JSON (not structuredClone): module configs / answers are plain data,
 * so JSON round-trips cleanly. Any Date, Map, or function would break this
 * — but GameState never carries those.
 */

// Version history:
//   v2 — the GameState shape gained `moduleSequence` / `strikeCount` /
//        `timeBudgetMs` / `outcome` in the game-modes rework.
//   v3 — the stopwatch rework REUSED the `timeBudgetMs` field but flipped its
//        meaning: it was a per-mode COUNTDOWN budget (600000 / 300000 ms), it
//        is now the 1-hour POSITIVE-COUNT hard cap (3600000 ms). The shape is
//        unchanged, so a stale v2 blob would not crash on restore — but its
//        old 600000 / 300000 value would be read as a hard cap, and the new
//        count-up timer ends the run the instant `elapsedMs >= timeBudgetMs`
//        (GamePage cap-detection). A daily run restored from a v2 blob would
//        therefore neutrally end at 10 minutes instead of running on. Bumping
//        the key forces any stale v2 entry to be ignored so the player gets a
//        clean fresh run carrying the correct 1-hour cap.
const KEY = 'bombsquad:game-state:v3'

export function loadPersistedState(): GameState | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as GameState
  } catch {
    // Corrupt JSON or quota error — pretend nothing was there.
    return null
  }
}

export function savePersistedState(state: GameState): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage full / private mode. Refresh-resilience just silently degrades.
  }
}

export function clearPersistedState(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
