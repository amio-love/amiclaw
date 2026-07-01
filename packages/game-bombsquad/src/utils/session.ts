import { getTodayString } from '@shared/date'

export type SessionMode = 'practice' | 'daily'

export const PRACTICE_SEED = 42
const ENTRY_RECOVERY_KEY = 'bombsquad:entry-recovery'

export interface EntryRecoveryState {
  mode: SessionMode
  manualUrl: string
  manualHandoffComplete: boolean
}

export function getRunSeed(mode: SessionMode, now = Date.now()): number {
  return mode === 'practice' ? PRACTICE_SEED : now
}

export function getDailyAttemptKey(date = getTodayString()): string {
  return `attempt-${date}`
}

export function readDailyAttemptCount(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
  date = getTodayString()
): number {
  const rawValue = storage.getItem(getDailyAttemptKey(date))
  const parsedValue = Number.parseInt(rawValue ?? '0', 10)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0
}

export function reserveDailyAttempt(
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  date = getTodayString()
): number {
  const nextAttempt = readDailyAttemptCount(storage, date) + 1
  storage.setItem(getDailyAttemptKey(date), String(nextAttempt))
  return nextAttempt
}

export function previewDailyAttemptNumber(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
  date = getTodayString()
): number {
  return readDailyAttemptCount(storage, date) + 1
}

export function commitDailyAttemptNumber(
  attemptNumber: number,
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  date = getTodayString()
): number {
  const safeAttemptNumber = Number.isFinite(attemptNumber) && attemptNumber > 0 ? attemptNumber : 1
  const currentAttemptCount = readDailyAttemptCount(storage, date)
  const committedAttempt = Math.max(currentAttemptCount, safeAttemptNumber)
  storage.setItem(getDailyAttemptKey(date), String(committedAttempt))
  return committedAttempt
}

export function getAttemptNumberForMode(
  mode: SessionMode,
  storage: Pick<Storage, 'getItem'> = sessionStorage,
  date = getTodayString()
): number {
  return mode === 'daily' ? previewDailyAttemptNumber(storage, date) : 1
}

export function commitAttemptNumberForMode(
  mode: SessionMode,
  attemptNumber: number,
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  date = getTodayString()
): number {
  return mode === 'daily' ? commitDailyAttemptNumber(attemptNumber, storage, date) : 1
}

export function saveEntryRecoveryState(
  state: EntryRecoveryState,
  storage: Pick<Storage, 'setItem'> = sessionStorage
): void {
  storage.setItem(ENTRY_RECOVERY_KEY, JSON.stringify(state))
}

export function readEntryRecoveryState(
  storage: Pick<Storage, 'getItem'> = sessionStorage
): EntryRecoveryState | null {
  const raw = storage.getItem(ENTRY_RECOVERY_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<EntryRecoveryState>
    if (parsed.mode !== 'daily' && parsed.mode !== 'practice') return null
    if (typeof parsed.manualUrl !== 'string') return null
    return {
      mode: parsed.mode,
      manualUrl: parsed.manualUrl,
      manualHandoffComplete: parsed.manualHandoffComplete === true,
    }
  } catch {
    return null
  }
}
