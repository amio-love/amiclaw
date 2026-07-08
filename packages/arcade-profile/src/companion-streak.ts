/**
 * Companion streak resolution — ACCOUNT-anchored (B9 叙事型成长).
 *
 * The companion familiarity a streak drives expresses the RELATIONSHIP, which
 * lives at the account (the companion is account-anchored; 连续性高于一切). So the
 * streak MUST be the account value, not a per-device count that would jump when
 * the player switches devices.
 *
 * Resolution order:
 *   1. the account profile API (`/api/arcade/profile` → `daily_loop.streak`) —
 *      the PRIMARY source; its value is cached on success for offline / latency;
 *   2. the last cached account value (stale-but-account, for a failed fetch);
 *   3. the device-local streak — ONLY ever a last-resort stale fallback, never
 *      the primary;
 *   4. 0.
 *
 * All companion surfaces require login, so the account value is normally
 * available; the cache and device fallbacks cover offline / latency / the brief
 * window before the first successful fetch.
 */

import { fetchArcadeProfile, type ArcadeProfileReadResult } from './api-client'
import { readArcadeLocalProfile, summarizeArcadeLocalProfile } from './local'

/** localStorage key for the last-known account streak (the offline cache). */
export const COMPANION_ACCOUNT_STREAK_CACHE_KEY = 'amio_companion_account_streak'

function browserStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/** Read the cached account streak (last known), or `null` when unset / invalid. */
export function readCachedAccountStreak(storage: Storage | null = browserStorage()): number | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(COMPANION_ACCOUNT_STREAK_CACHE_KEY)
    if (raw === null) return null
    const days = Number.parseInt(raw, 10)
    return Number.isFinite(days) && days >= 0 ? days : null
  } catch {
    return null
  }
}

/** Cache the account streak for offline / latency reads. */
export function writeCachedAccountStreak(
  days: number,
  storage: Storage | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(COMPANION_ACCOUNT_STREAK_CACHE_KEY, String(Math.max(0, Math.floor(days))))
  } catch {
    // Cache write failure is non-fatal — the account is the SSOT.
  }
}

/** The device-local streak — the last-resort stale fallback, never primary. */
export function deviceLocalStreakDays(storage: Storage | null = browserStorage()): number {
  return summarizeArcadeLocalProfile(readArcadeLocalProfile(storage)).daily_loop.streak.current_days
}

export interface ResolveAccountStreakDeps {
  /** Injectable for tests; defaults to the real profile fetch. */
  fetchProfile?: () => Promise<ArcadeProfileReadResult>
  /** Injectable storage; defaults to `window.localStorage`. */
  storage?: Storage | null
}

/**
 * Resolve the companion streak, account-anchored. On a successful fetch the
 * account value WINS over any cached value and refreshes the cache; on failure
 * it falls back to the cache, then the device-local streak, then 0.
 */
export async function resolveAccountStreak(deps: ResolveAccountStreakDeps = {}): Promise<number> {
  const fetchProfile = deps.fetchProfile ?? fetchArcadeProfile
  const storage = deps.storage === undefined ? browserStorage() : deps.storage

  const result = await fetchProfile()
  if (result.kind === 'ok') {
    const days = result.profile.daily_loop.streak.current_days
    writeCachedAccountStreak(days, storage)
    return days
  }

  const cached = readCachedAccountStreak(storage)
  if (cached !== null) return cached
  return deviceLocalStreakDays(storage)
}
