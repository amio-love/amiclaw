import { useState, useCallback } from 'react'
import { getTodayString } from '@/utils/date'
import { readDailyAttemptCount, reserveDailyAttempt } from '@/utils/session'

/**
 * Pick the origin that the AI partner should fetch the manual from.
 *
 * Whichever URL the player has the game open on, that same origin is
 * guaranteed to be serving the matching manual (via the
 * `functions/manual/[date].ts` Pages Function). Hardcoding a brand URL
 * like `bombsquad.amio.fans` meant the copied prompt pointed at a
 * domain that had not been wired up yet — players hit 404 and the AI
 * had nothing to read. Reading `window.location.origin` at render time
 * makes the URL self-heal across `amiclaw.pages.dev`, a custom domain,
 * and preview deployments alike.
 *
 * SSR / test environments don't have `window`. We fall back to the
 * expected production domain so unit tests continue to see a stable
 * string and can still assert on it.
 */
function getOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'https://bombsquad.amio.fans'
}

/**
 * Returns manual URLs for today's daily challenge and the practice mode.
 * Tracks attempt number per day in sessionStorage.
 */
export function useDailyChallenge(): {
  practiceUrl: string
  dailyUrl: string
  attemptNumber: number
  incrementAttempt: () => void
} {
  const today = getTodayString()
  const origin = getOrigin()
  const dailyUrl = `${origin}/manual/${today}`
  const practiceUrl = `${origin}/manual/practice`

  const [attemptNumber, setAttemptNumber] = useState(() =>
    readDailyAttemptCount(sessionStorage, today)
  )

  const incrementAttempt = useCallback(() => {
    setAttemptNumber(reserveDailyAttempt(sessionStorage, today))
  }, [today])

  return { practiceUrl, dailyUrl, attemptNumber, incrementAttempt }
}
