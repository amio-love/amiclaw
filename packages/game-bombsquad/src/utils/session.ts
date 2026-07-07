import { getTodayString } from '@shared/date'

export type SessionMode = 'practice' | 'daily'

const ENTRY_RECOVERY_KEY = 'bombsquad:entry-recovery'

export interface EntryRecoveryState {
  mode: SessionMode
  manualUrl: string
  manualHandoffComplete: boolean
  /**
   * True when the run used the platform voice partner (mode②,
   * `?partner=platform`). Replay / recovery paths must preserve it: a mode②
   * player never completed the manual handoff, so dropping the flag would
   * route their next run into mode① with no AI partner connected.
   */
  platformPartner: boolean
}

/**
 * Every run — practice and daily alike — draws a fresh wall-clock seed, so
 * each run generates a fresh puzzle instance within its manual's fixed rule
 * space. Practice used to pin a constant seed (42) "so the puzzle is
 * reproducible", but that froze the practice bomb to one eternal instance:
 * the second play becomes answer recall and practice stops teaching. The
 * practice MANUAL stays permanently stable (it is the learning reference the
 * player hands their AI); only the drawn instance rotates — exactly the
 * daily-challenge split of fixed manual vs per-run random instance.
 */
export function getRunSeed(now = Date.now()): number {
  return now
}

export function createGameRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function getDailyAttemptKey(date = getTodayString()): string {
  return `attempt-${date}`
}

export type DailyAttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const memoryAttemptStore = new Map<string, string>()
const memoryAttemptStorage: DailyAttemptStorage = {
  getItem: (key) => memoryAttemptStore.get(key) ?? null,
  setItem: (key, value) => {
    memoryAttemptStore.set(key, value)
  },
  removeItem: (key) => {
    memoryAttemptStore.delete(key)
  },
}

/**
 * Daily attempt counts live in localStorage so the count is cumulative for
 * the whole day: sessionStorage reset the counter on every new tab/session,
 * letting any run present itself as "attempt 1". localStorage also keeps the
 * counter aligned with the player identity — the device UUID and nickname
 * live there too, so clearing it resets all three together. Falls back to an
 * in-memory store when localStorage is unavailable (private browsing,
 * restricted embeds, jsdom).
 */
export function getDailyAttemptStorage(): DailyAttemptStorage {
  try {
    const storage = globalThis.localStorage
    if (storage) return storage
  } catch {
    // SecurityError in restricted contexts — fall through to memory.
  }
  return memoryAttemptStorage
}

export function readDailyAttemptCount(
  storage: Pick<Storage, 'getItem'> = getDailyAttemptStorage(),
  date = getTodayString()
): number {
  const rawValue = storage.getItem(getDailyAttemptKey(date))
  const parsedValue = Number.parseInt(rawValue ?? '0', 10)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0
}

export function reserveDailyAttempt(
  storage: Pick<Storage, 'getItem' | 'setItem'> = getDailyAttemptStorage(),
  date = getTodayString()
): number {
  const nextAttempt = readDailyAttemptCount(storage, date) + 1
  storage.setItem(getDailyAttemptKey(date), String(nextAttempt))
  return nextAttempt
}

export function previewDailyAttemptNumber(
  storage: Pick<Storage, 'getItem'> = getDailyAttemptStorage(),
  date = getTodayString()
): number {
  return readDailyAttemptCount(storage, date) + 1
}

export function commitDailyAttemptNumber(
  attemptNumber: number,
  storage: Pick<Storage, 'getItem' | 'setItem'> = getDailyAttemptStorage(),
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
  storage: Pick<Storage, 'getItem'> = getDailyAttemptStorage(),
  date = getTodayString()
): number {
  return mode === 'daily' ? previewDailyAttemptNumber(storage, date) : 1
}

export function commitAttemptNumberForMode(
  mode: SessionMode,
  attemptNumber: number,
  storage: Pick<Storage, 'getItem' | 'setItem'> = getDailyAttemptStorage(),
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
      platformPartner: parsed.platformPartner === true,
    }
  } catch {
    return null
  }
}
