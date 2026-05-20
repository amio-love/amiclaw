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

// v2: the GameState shape gained `moduleSequence` / `strikeCount` /
// `timeBudgetMs` / `outcome` in the game-modes rework. A v1 blob persisted by
// the previous build lacks those fields and would crash the generalised
// renderer on restore, so the key is bumped — a stale v1 entry is simply
// ignored and the player gets a clean fresh run.
const KEY = 'bombsquad:game-state:v2'

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
