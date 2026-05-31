import { describe, expect, it } from 'vitest'
import {
  PRACTICE_SEED,
  getAttemptNumberForMode,
  getRunSeed,
  readDailyAttemptCount,
  reserveDailyAttempt,
} from './session'

function createStorageStub(initialEntries: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialEntries))
  return {
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

describe('session utilities', () => {
  it('uses a fixed seed for practice mode', () => {
    expect(getRunSeed('practice')).toBe(PRACTICE_SEED)
    expect(getRunSeed('daily', 123456)).toBe(123456)
  })

  it('reserves and reads daily attempts from storage', () => {
    const storage = createStorageStub()
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(0)
    expect(reserveDailyAttempt(storage, '2026-03-27')).toBe(1)
    expect(reserveDailyAttempt(storage, '2026-03-27')).toBe(2)
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(2)
  })

  it('returns mode-specific attempt numbers', () => {
    const storage = createStorageStub({ 'attempt-2026-03-27': '3' })
    expect(getAttemptNumberForMode('practice', storage, '2026-03-27')).toBe(1)
    expect(getAttemptNumberForMode('daily', storage, '2026-03-27')).toBe(4)
  })
})
