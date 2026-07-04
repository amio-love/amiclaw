import { describe, expect, it } from 'vitest'
import {
  PRACTICE_SEED,
  commitAttemptNumberForMode,
  commitDailyAttemptNumber,
  createGameRunId,
  getAttemptNumberForMode,
  getRunSeed,
  readEntryRecoveryState,
  readDailyAttemptCount,
  reserveDailyAttempt,
  saveEntryRecoveryState,
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

  it('creates a non-empty run identity', () => {
    expect(createGameRunId()).toMatch(/^[a-z0-9-]+$/i)
  })

  it('reserves and reads daily attempts from storage', () => {
    const storage = createStorageStub()
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(0)
    expect(reserveDailyAttempt(storage, '2026-03-27')).toBe(1)
    expect(reserveDailyAttempt(storage, '2026-03-27')).toBe(2)
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(2)
  })

  it('returns mode-specific preview attempt numbers without reserving daily storage', () => {
    const storage = createStorageStub({ 'attempt-2026-03-27': '3' })
    expect(getAttemptNumberForMode('practice', storage, '2026-03-27')).toBe(1)
    expect(getAttemptNumberForMode('daily', storage, '2026-03-27')).toBe(4)
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(3)
  })

  it('commits a previewed daily attempt idempotently when a run starts', () => {
    const storage = createStorageStub({ 'attempt-2026-03-27': '3' })
    const previewAttempt = getAttemptNumberForMode('daily', storage, '2026-03-27')
    expect(previewAttempt).toBe(4)

    expect(commitDailyAttemptNumber(previewAttempt, storage, '2026-03-27')).toBe(4)
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(4)

    expect(commitDailyAttemptNumber(previewAttempt, storage, '2026-03-27')).toBe(4)
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(4)
  })

  it('commits attempts by mode', () => {
    const storage = createStorageStub()
    expect(commitAttemptNumberForMode('practice', 9, storage, '2026-03-27')).toBe(1)
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(0)

    expect(commitAttemptNumberForMode('daily', 1, storage, '2026-03-27')).toBe(1)
    expect(readDailyAttemptCount(storage, '2026-03-27')).toBe(1)
  })

  it('round-trips the entry recovery state', () => {
    const storage = createStorageStub()
    saveEntryRecoveryState(
      {
        mode: 'practice',
        manualUrl: 'https://claw.amio.fans/manual/practice',
        manualHandoffComplete: true,
      },
      storage
    )

    expect(readEntryRecoveryState(storage)).toEqual({
      mode: 'practice',
      manualUrl: 'https://claw.amio.fans/manual/practice',
      manualHandoffComplete: true,
    })
  })

  it('ignores invalid entry recovery state', () => {
    const storage = createStorageStub({
      'bombsquad:entry-recovery': JSON.stringify({
        mode: 'weekly',
        manualUrl: 'https://claw.amio.fans/manual/practice',
      }),
    })

    expect(readEntryRecoveryState(storage)).toBeNull()
  })
})
