import type { LeaderboardEntry } from '@shared/leaderboard-types'

/**
 * Cross-page optimistic-update helpers for the daily leaderboard.
 *
 * The flow:
 *  1. ResultPage submits a score. On success it stores an optimistic
 *     LeaderboardEntry under `optimistic-leaderboard:<date>` in sessionStorage.
 *  2. LeaderboardPage merges the optimistic entry into the GET response so the
 *     player sees their result immediately, even though the GET sits behind a
 *     60-second cache. The entry is marked with `_justSubmitted: true` so the
 *     UI can highlight it via `data-just-submitted`.
 *  3. Once the player navigates away and the cache flips, the next GET will
 *     contain the authoritative copy. The optimistic entry is cleared on each
 *     successful GET so it never lingers.
 *
 * sessionStorage scope is intentional: an optimistic entry only matters for
 * the current tab/session and should not survive a tab close.
 */

const KEY_PREFIX = 'optimistic-leaderboard:'

export interface OptimisticLeaderboardEntry extends LeaderboardEntry {
  _justSubmitted: true
}

function storageKey(date: string): string {
  return `${KEY_PREFIX}${date}`
}

export function saveOptimisticEntry(date: string, entry: LeaderboardEntry): void {
  try {
    sessionStorage.setItem(storageKey(date), JSON.stringify(entry))
  } catch {
    /* storage full or unavailable; silently skip — the GET refresh path is the safety net */
  }
}

export function loadOptimisticEntry(date: string): OptimisticLeaderboardEntry | null {
  try {
    const raw = sessionStorage.getItem(storageKey(date))
    if (!raw) return null
    const parsed = JSON.parse(raw) as LeaderboardEntry
    if (
      typeof parsed?.rank !== 'number' ||
      typeof parsed?.nickname !== 'string' ||
      typeof parsed?.time_ms !== 'number'
    ) {
      return null
    }
    return { ...parsed, _justSubmitted: true }
  } catch {
    return null
  }
}

export function clearOptimisticEntry(date: string): void {
  try {
    sessionStorage.removeItem(storageKey(date))
  } catch {
    /* ignore */
  }
}

/**
 * Returns true if `entries` already contains a row that matches the optimistic
 * one on (nickname, time_ms, attempt_number) — i.e. the cache has flipped and
 * the authoritative row is now present.
 */
export function entriesContainOptimistic(
  entries: LeaderboardEntry[],
  optimistic: LeaderboardEntry
): boolean {
  return entries.some(
    (e) =>
      e.nickname === optimistic.nickname &&
      e.time_ms === optimistic.time_ms &&
      e.attempt_number === optimistic.attempt_number
  )
}

/**
 * Insert the optimistic entry at position `entry.rank - 1` (clamped) into the
 * given entries array. Existing entries at and below that rank are shifted by
 * one so the displayed ranks remain monotonic. Does not mutate `entries`.
 */
export function mergeOptimisticEntry(
  entries: LeaderboardEntry[],
  optimistic: OptimisticLeaderboardEntry
): LeaderboardEntry[] {
  const insertAt = Math.max(0, Math.min(entries.length, optimistic.rank - 1))
  const before = entries.slice(0, insertAt).map((e) => ({ ...e }))
  const after = entries.slice(insertAt).map((e) => ({ ...e, rank: e.rank + 1 }))
  return [...before, optimistic, ...after]
}
