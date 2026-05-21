import { useEffect, useMemo, useState } from 'react'

/**
 * Live countdown to the next UTC midnight (00:00), returned as a
 * zero-padded `[hh, mm, ss]` string tuple. The internal clock ticks
 * once per second.
 *
 * Distinct from `useDailyChallenge`, which yields manual URLs — this
 * hook is purely the daily-reset clock. Ported from the atlas design
 * prototype's `useDailyCountdown`.
 */
export function useDailyCountdown(): [string, string, string] {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return useMemo<[string, string, string]>(() => {
    const next = new Date(now)
    next.setUTCHours(24, 0, 0, 0) // roll to the next UTC midnight

    let remaining = Math.max(0, next.getTime() - now.getTime())
    const hours = Math.floor(remaining / 3_600_000)
    remaining -= hours * 3_600_000
    const minutes = Math.floor(remaining / 60_000)
    remaining -= minutes * 60_000
    const seconds = Math.floor(remaining / 1_000)

    const pad = (value: number) => String(value).padStart(2, '0')
    return [pad(hours), pad(minutes), pad(seconds)]
  }, [now])
}
