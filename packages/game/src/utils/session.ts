import { getTodayString } from '@/utils/date'

export type SessionMode = 'practice' | 'daily'

export const PRACTICE_SEED = 42

export function getRunSeed(mode: SessionMode, now = Date.now()): number {
  return mode === 'practice' ? PRACTICE_SEED : now
}

export function getDailyAttemptKey(date = getTodayString()): string {
  return `attempt-${date}`
}

export function readDailyAttemptCount(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
  date = getTodayString(),
): number {
  const rawValue = storage.getItem(getDailyAttemptKey(date))
  const parsedValue = Number.parseInt(rawValue ?? '0', 10)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0
}

export function reserveDailyAttempt(
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  date = getTodayString(),
): number {
  const nextAttempt = readDailyAttemptCount(storage, date) + 1
  storage.setItem(getDailyAttemptKey(date), String(nextAttempt))
  return nextAttempt
}

export function getAttemptNumberForMode(
  mode: SessionMode,
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  date = getTodayString(),
): number {
  return mode === 'daily' ? reserveDailyAttempt(storage, date) : 1
}
