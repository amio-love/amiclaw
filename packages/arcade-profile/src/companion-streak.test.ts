/**
 * companion-streak — account-anchored streak resolution (B9).
 *
 * The relationship lives at the account, so the streak that drives companion
 * familiarity MUST be the account value: the fresh account fetch WINS over any
 * cached / device-local value, and the device-local streak is only ever a
 * last-resort stale fallback.
 */
import { describe, expect, it } from 'vitest'
import { deriveFamiliarityTier } from '../../../shared/companion-familiarity'
import type { ArcadeProfileReadResult } from './api-client'
import {
  COMPANION_ACCOUNT_STREAK_CACHE_KEY,
  deviceLocalStreakDays,
  readCachedAccountStreak,
  resolveAccountStreak,
  writeCachedAccountStreak,
} from './companion-streak'
import { summarizeArcadeProfile } from './summary'

const TODAY = '2026-07-08'

/** A full in-memory Storage so the real read/write paths run under the typecheck. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

/** A real, typed profile read whose derived streak is exactly `days`. */
function profileWithStreak(days: number): ArcadeProfileReadResult {
  const dates = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2026, 6, 8) - i * 86_400_000).toISOString().slice(0, 10)
    return { date, completed_at: `${date}T10:00:00.000Z` }
  })
  const profile = summarizeArcadeProfile({
    bombsquadRuns: [],
    oracleSigns: [],
    today: TODAY,
    qualifiedBombSquadDates: dates,
    qualifiedOracleDates: [],
  })
  return { kind: 'ok', profile, publicProfile: { claimed: false, public_label: null } }
}

describe('resolveAccountStreak', () => {
  it('returns the account value and refreshes the cache — the account WINS over a stale cache', async () => {
    const storage = memoryStorage({ [COMPANION_ACCOUNT_STREAK_CACHE_KEY]: '7' })
    const days = await resolveAccountStreak({
      fetchProfile: () => Promise.resolve(profileWithStreak(30)),
      storage,
    })
    expect(days).toBe(30)
    expect(readCachedAccountStreak(storage)).toBe(30)
    // Tier follows the ACCOUNT value, not the stale cache (which would be familiar).
    expect(deriveFamiliarityTier(days)).toBe('close')
    expect(deriveFamiliarityTier(7)).toBe('familiar')
  })

  it('falls back to the cached account value when the fetch fails', async () => {
    const storage = memoryStorage({ [COMPANION_ACCOUNT_STREAK_CACHE_KEY]: '12' })
    const days = await resolveAccountStreak({
      fetchProfile: () => Promise.resolve({ kind: 'error' }),
      storage,
    })
    expect(days).toBe(12)
  })

  it('falls back to the device-local streak only when the fetch fails and no cache exists', async () => {
    const storage = memoryStorage()
    const days = await resolveAccountStreak({
      fetchProfile: () => Promise.resolve({ kind: 'error' }),
      storage,
    })
    // An empty device profile is a 0-day streak — the last-resort fallback.
    expect(days).toBe(deviceLocalStreakDays(storage))
    expect(days).toBe(0)
  })
})

describe('account-streak cache', () => {
  it('round-trips and rejects junk', () => {
    const storage = memoryStorage()
    expect(readCachedAccountStreak(storage)).toBeNull()
    writeCachedAccountStreak(9, storage)
    expect(readCachedAccountStreak(storage)).toBe(9)
    storage.setItem(COMPANION_ACCOUNT_STREAK_CACHE_KEY, 'abc')
    expect(readCachedAccountStreak(storage)).toBeNull()
  })
})
