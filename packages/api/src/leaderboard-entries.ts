import type { LeaderboardEntry } from '../../../shared/leaderboard-types'

/**
 * Internal KV row shape: the public LeaderboardEntry plus two backend-only
 * keys. Both are stripped in get-leaderboard.ts before the public response.
 *
 *  - `run_id`    — per-run idempotency key (double-POST of the same run).
 *  - `device_id` — per-player dedup key (one row per player per day). The
 *    localStorage device UUID is the strongest player identity the anonymous
 *    leaderboard has; clearing localStorage rotates it, which also resets the
 *    nickname and attempt counter, so a "new" device is a new player.
 */
export type StoredEntry = LeaderboardEntry & { run_id?: string; device_id?: string }

/**
 * Collapse a day's rows to one entry per player (best time wins), then
 * re-sort ascending by time and reassign ranks.
 *
 * Dedup keys, in order of strength:
 *  1. `device_id` — rows sharing a device keep only the fastest (ties keep
 *     the incumbent, mirroring personal-best's strict-`<` rule).
 *  2. Legacy rows (written before device_id was stored) fall back to
 *     `nickname`. Two distinct players sharing a nickname in legacy data
 *     would wrongly collapse; accepted — legacy rows age out with the 48h
 *     KV TTL.
 *  3. Transition bridge: a legacy row sharing a nickname with a device-keyed
 *     row is treated as the same player. The better time survives and adopts
 *     the device_id so future write-time dedup stays keyed on the device.
 */
export function dedupeStoredEntries(entries: StoredEntry[]): StoredEntry[] {
  const byDevice = new Map<string, StoredEntry>()
  const legacyByNickname = new Map<string, StoredEntry>()

  const better = (incumbent: StoredEntry | undefined, candidate: StoredEntry): StoredEntry =>
    incumbent === undefined || candidate.time_ms < incumbent.time_ms ? candidate : incumbent

  for (const entry of entries) {
    if (entry.device_id) {
      byDevice.set(entry.device_id, better(byDevice.get(entry.device_id), entry))
    } else {
      legacyByNickname.set(entry.nickname, better(legacyByNickname.get(entry.nickname), entry))
    }
  }

  for (const [nickname, legacy] of legacyByNickname) {
    let bestDeviceId: string | null = null
    let bestRow: StoredEntry | null = null
    for (const [deviceId, row] of byDevice) {
      if (row.nickname !== nickname) continue
      if (bestRow === null || row.time_ms < bestRow.time_ms) {
        bestRow = row
        bestDeviceId = deviceId
      }
    }
    if (bestRow === null || bestDeviceId === null) continue
    legacyByNickname.delete(nickname)
    if (legacy.time_ms < bestRow.time_ms) {
      byDevice.set(bestDeviceId, { ...legacy, device_id: bestDeviceId })
    }
  }

  return [...byDevice.values(), ...legacyByNickname.values()]
    .sort((a, b) => a.time_ms - b.time_ms)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }))
}
