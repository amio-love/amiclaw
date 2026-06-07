import { useEffect, useState } from 'react'
import { fetchLeaderboard } from '@shared/leaderboard-api'
import { getTodayString } from '@shared/date'

/**
 * Real daily-board summary stats for the BombSquad landing page.
 *
 * BombSquad is its own SPA and cannot import the platform's `useDailyBoard`
 * hook, but `@shared/leaderboard-api` is shared across every package — so the
 * landing reads the same daily leaderboard API as the platform homepage and
 * the /leaderboard 每日 tab. It fetches once on mount and derives the two
 * stats the landing card shows: today's #1 time and the participation count.
 *
 * When the board is genuinely empty (beta has no scores yet), `leaderTimeMs`
 * is `null` and `participantCount` is `0` — the landing renders honest empty /
 * zero states, never a fabricated leader time or participant count.
 */
export interface DailyBoardStats {
  participantCount: number
  leaderTimeMs: number | null
}

export function useDailyBoardStats(): DailyBoardStats {
  const today = getTodayString()
  const [participantCount, setParticipantCount] = useState(0)
  const [leaderTimeMs, setLeaderTimeMs] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    fetchLeaderboard(today).then((data) => {
      if (!active || !data) return
      setParticipantCount(data.entries.length)
      setLeaderTimeMs(data.entries.length > 0 ? data.entries[0].time_ms : null)
    })
    return () => {
      active = false
    }
  }, [today])

  return { participantCount, leaderTimeMs }
}
