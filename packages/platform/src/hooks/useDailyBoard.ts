import { useCallback, useEffect, useState } from 'react'
import { fetchLeaderboard } from '@shared/leaderboard-api'
import { getTodayString } from '@shared/date'
import type { LeaderboardEntry } from '@shared/leaderboard-types'

/**
 * Single real-data source for every homepage「今日 / 在线 / 日榜」surface.
 *
 * The homepage container fetches today's daily board ONCE through this hook
 * and threads the result (plus derived stats) down to the hero and NOW
 * PLAYING components — instead of each surface inventing its own mock data.
 * It mirrors the canonical fetch in `DailyLeaderboardList` but omits the
 * result-page optimistic seed: the homepage only reads, it never submits.
 *
 * When the board is genuinely empty (beta has no scores yet), `entries` is
 * `[]` and consumers render honest empty / zero states — never a fabricated
 * participation count or leader time.
 */
export interface DailyBoardState {
  loading: boolean
  error: boolean
  entries: LeaderboardEntry[]
  /** Number of real entries on today's board (0 when empty). */
  participantCount: number
  /** #1 time today in ms, or null when the board is empty. */
  leaderTimeMs: number | null
}

export function useDailyBoard(): DailyBoardState {
  const today = getTodayString()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    fetchLeaderboard(today).then((data) => {
      setLoading(false)
      if (data) {
        setEntries(data.entries)
      } else {
        setError(true)
      }
    })
  }, [today])

  useEffect(() => {
    load()
  }, [load])

  return {
    loading,
    error,
    entries,
    participantCount: entries.length,
    leaderTimeMs: entries.length > 0 ? entries[0].time_ms : null,
  }
}
