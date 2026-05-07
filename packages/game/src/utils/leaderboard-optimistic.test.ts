import { afterEach, describe, it, expect } from 'vitest'
import type { LeaderboardEntry } from '@shared/leaderboard-types'
import {
  clearOptimisticEntry,
  entriesContainOptimistic,
  loadOptimisticEntry,
  mergeOptimisticEntry,
  saveOptimisticEntry,
} from './leaderboard-optimistic'

const DATE = '2026-05-07'

const baseEntry: LeaderboardEntry = {
  rank: 2,
  nickname: 'Anonymous',
  time_ms: 91234,
  attempt_number: 3,
  ai_tool: 'claude',
}

describe('leaderboard-optimistic', () => {
  afterEach(() => {
    sessionStorage.clear()
  })

  describe('save / load / clear round-trip', () => {
    it('stores and retrieves an entry, marking it _justSubmitted', () => {
      saveOptimisticEntry(DATE, baseEntry)
      const loaded = loadOptimisticEntry(DATE)
      expect(loaded).toMatchObject(baseEntry)
      expect(loaded?._justSubmitted).toBe(true)
    })

    it('returns null when nothing is stored', () => {
      expect(loadOptimisticEntry(DATE)).toBeNull()
    })

    it('clears the stored entry', () => {
      saveOptimisticEntry(DATE, baseEntry)
      clearOptimisticEntry(DATE)
      expect(loadOptimisticEntry(DATE)).toBeNull()
    })

    it('isolates entries by date', () => {
      saveOptimisticEntry(DATE, baseEntry)
      expect(loadOptimisticEntry('2026-05-08')).toBeNull()
    })

    it('rejects malformed payloads', () => {
      sessionStorage.setItem(`optimistic-leaderboard:${DATE}`, '{"rank":"oops"}')
      expect(loadOptimisticEntry(DATE)).toBeNull()
    })
  })

  describe('mergeOptimisticEntry', () => {
    const existing: LeaderboardEntry[] = [
      { rank: 1, nickname: 'Alpha', time_ms: 80000, attempt_number: 1 },
      { rank: 2, nickname: 'Beta', time_ms: 95000, attempt_number: 1 },
      { rank: 3, nickname: 'Gamma', time_ms: 110000, attempt_number: 1 },
    ]

    it('inserts at rank-1 and shifts subsequent ranks', () => {
      const optimistic = { ...baseEntry, rank: 2, _justSubmitted: true as const }
      const merged = mergeOptimisticEntry(existing, optimistic)
      expect(merged).toHaveLength(4)
      expect(merged[0]).toMatchObject({ rank: 1, nickname: 'Alpha' })
      expect(merged[1]).toBe(optimistic)
      expect(merged[2]).toMatchObject({ rank: 3, nickname: 'Beta' })
      expect(merged[3]).toMatchObject({ rank: 4, nickname: 'Gamma' })
    })

    it('clamps a rank past the end of the list to append', () => {
      const optimistic = { ...baseEntry, rank: 99, _justSubmitted: true as const }
      const merged = mergeOptimisticEntry(existing, optimistic)
      expect(merged).toHaveLength(4)
      expect(merged[3]).toBe(optimistic)
    })

    it('does not mutate the input', () => {
      const optimistic = { ...baseEntry, rank: 1, _justSubmitted: true as const }
      const before = JSON.parse(JSON.stringify(existing))
      mergeOptimisticEntry(existing, optimistic)
      expect(existing).toEqual(before)
    })

    it('handles empty entries (cache miss / first submission)', () => {
      const optimistic = { ...baseEntry, rank: 1, _justSubmitted: true as const }
      const merged = mergeOptimisticEntry([], optimistic)
      expect(merged).toEqual([optimistic])
    })
  })

  describe('entriesContainOptimistic', () => {
    it('returns true when nickname/time/attempt match', () => {
      const entries: LeaderboardEntry[] = [
        { rank: 1, nickname: 'Alpha', time_ms: 80000, attempt_number: 1 },
        { rank: 2, nickname: 'Anonymous', time_ms: 91234, attempt_number: 3 },
      ]
      expect(entriesContainOptimistic(entries, baseEntry)).toBe(true)
    })

    it('returns false when nothing matches', () => {
      const entries: LeaderboardEntry[] = [
        { rank: 1, nickname: 'Alpha', time_ms: 80000, attempt_number: 1 },
      ]
      expect(entriesContainOptimistic(entries, baseEntry)).toBe(false)
    })
  })
})
