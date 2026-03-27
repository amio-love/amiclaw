import { useState, useCallback } from 'react'
import { getTodayString } from '@/utils/date'
import {
  readDailyAttemptCount,
  reserveDailyAttempt,
} from '@/utils/session'

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
  const dailyUrl = `https://bombsquad.amio.fans/manual/${today}`
  const practiceUrl = 'https://bombsquad.amio.fans/manual/practice'

  const [attemptNumber, setAttemptNumber] = useState(() => readDailyAttemptCount(sessionStorage, today))

  const incrementAttempt = useCallback(() => {
    setAttemptNumber(reserveDailyAttempt(sessionStorage, today))
  }, [today])

  return { practiceUrl, dailyUrl, attemptNumber, incrementAttempt }
}
