/**
 * gameReducer unit tests — the game-modes rework state machine.
 *
 * Covers the new daily/practice branching: the 3-strike fail rule, the
 * countdown TIME_EXPIRED branch, the EXPLODING transition, module-sequence
 * generalisation (practice runs fewer modules), and the last-module win lock
 * that protects an already-won daily run from a racing TIME_EXPIRED.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The reducer fires telemetry on several transitions; stub it so tests do not
// attempt a real /api/events POST.
vi.mock('@/utils/event-log', () => ({ logEvent: vi.fn() }))

import {
  gameReducer,
  MODULE_SEQUENCE,
  TIME_BUDGET_MS,
  MAX_STRIKES,
  type GameState,
} from './game-context'
import { logEvent } from '@/utils/event-log'

/** A PLAYING daily-run state; override per test. */
function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    status: 'PLAYING',
    mode: 'daily',
    manual: null,
    manualUrl: null,
    sceneInfo: null,
    moduleSequence: ['wire', 'dial', 'button', 'keypad'],
    moduleConfigs: [null, null, null, null],
    moduleAnswers: [null, null, null, null],
    currentModuleIndex: 0,
    moduleStats: [],
    totalStartTime: 1_700_000_000_000,
    totalEndTime: null,
    currentModuleStartTime: 1_700_000_000_000,
    currentModuleErrorCount: 0,
    strikeCount: 0,
    timeBudgetMs: 600_000,
    outcome: null,
    errorMessage: null,
    errorKind: null,
    attemptNumber: 1,
    rngSeed: 42,
    ...overrides,
  }
}

describe('gameReducer — START_LOADING', () => {
  it('derives the module sequence and null config slots per mode', () => {
    const daily = gameReducer(baseState(), {
      type: 'START_LOADING',
      mode: 'daily',
      manualUrl: 'u',
      attemptNumber: 1,
    })
    expect(daily.moduleSequence).toEqual(MODULE_SEQUENCE.daily)
    expect(daily.moduleConfigs).toHaveLength(MODULE_SEQUENCE.daily.length)
    expect(daily.moduleConfigs.every((c) => c === null)).toBe(true)

    const practice = gameReducer(baseState(), {
      type: 'START_LOADING',
      mode: 'practice',
      manualUrl: 'u',
      attemptNumber: 1,
    })
    expect(practice.moduleSequence).toEqual(MODULE_SEQUENCE.practice)
    expect(practice.moduleConfigs).toHaveLength(2)
  })
})

describe('gameReducer — START_GAME', () => {
  // START_GAME asserts (in dev) that every module config is non-null, so the
  // READY-state fixtures here carry placeholder configs.
  const filled4 = [{}, {}, {}, {}] as unknown as GameState['moduleConfigs']
  const filled2 = [{}, {}] as unknown as GameState['moduleConfigs']

  it('stamps the per-mode time budget and resets strikes', () => {
    const daily = gameReducer(
      baseState({ status: 'READY', strikeCount: 2, moduleConfigs: filled4 }),
      { type: 'START_GAME' }
    )
    expect(daily.status).toBe('PLAYING')
    expect(daily.timeBudgetMs).toBe(TIME_BUDGET_MS.daily)
    expect(daily.strikeCount).toBe(0)

    const practice = gameReducer(
      baseState({
        status: 'READY',
        mode: 'practice',
        moduleSequence: ['wire', 'keypad'],
        moduleConfigs: filled2,
      }),
      { type: 'START_GAME' }
    )
    expect(practice.timeBudgetMs).toBe(TIME_BUDGET_MS.practice)
  })
})

describe('gameReducer — MODULE_ERROR (daily 3-strike rule)', () => {
  it('detonates the bomb on the third strike', () => {
    let s = baseState({ mode: 'daily', status: 'PLAYING' })

    s = gameReducer(s, { type: 'MODULE_ERROR' })
    expect(s.strikeCount).toBe(1)
    expect(s.status).toBe('PLAYING')

    s = gameReducer(s, { type: 'MODULE_ERROR' })
    expect(s.strikeCount).toBe(2)
    expect(s.status).toBe('PLAYING')

    s = gameReducer(s, { type: 'MODULE_ERROR' })
    expect(s.strikeCount).toBe(MAX_STRIKES)
    expect(s.status).toBe('EXPLODING')
    expect(s.outcome).toBe('exploded')
    expect(s.totalEndTime).not.toBeNull()
  })

  it('does not regenerate the current module on a wrong answer', () => {
    const s = baseState({ mode: 'daily', status: 'PLAYING' })
    const after = gameReducer(s, { type: 'MODULE_ERROR' })
    // Same array references — the puzzle is untouched, the player retries it.
    expect(after.moduleConfigs).toBe(s.moduleConfigs)
    expect(after.moduleAnswers).toBe(s.moduleAnswers)
    expect(after.currentModuleErrorCount).toBe(1)
  })

  it('is a no-op when the run is no longer PLAYING', () => {
    const exploding = baseState({ mode: 'daily', status: 'EXPLODING', outcome: 'exploded' })
    expect(gameReducer(exploding, { type: 'MODULE_ERROR' })).toBe(exploding)
  })
})

describe('gameReducer — MODULE_ERROR (practice never fails)', () => {
  it('counts the error but never strikes or explodes', () => {
    const s = baseState({ mode: 'practice', status: 'PLAYING', moduleSequence: ['wire', 'keypad'] })
    const after = gameReducer(s, { type: 'MODULE_ERROR' })
    expect(after.currentModuleErrorCount).toBe(1)
    expect(after.strikeCount).toBe(0)
    expect(after.status).toBe('PLAYING')
    expect(after.outcome).toBeNull()
  })
})

describe('gameReducer — TIME_EXPIRED', () => {
  it('daily: countdown hitting zero detonates the bomb', () => {
    const s = baseState({ mode: 'daily', status: 'PLAYING' })
    const after = gameReducer(s, { type: 'TIME_EXPIRED' })
    expect(after.status).toBe('EXPLODING')
    expect(after.outcome).toBe('exploded')
    expect(after.totalEndTime).not.toBeNull()
  })

  it('practice: countdown hitting zero gently ends the run, no explosion', () => {
    const s = baseState({ mode: 'practice', status: 'PLAYING', moduleSequence: ['wire', 'keypad'] })
    const after = gameReducer(s, { type: 'TIME_EXPIRED' })
    expect(after.status).toBe('RESULT')
    expect(after.outcome).toBe('practice-timeout')
    expect(after.totalEndTime).not.toBeNull()
  })

  it('is a no-op once the run is already resolved', () => {
    const resolved = baseState({ status: 'EXPLODING', outcome: 'exploded', totalEndTime: 123 })
    expect(gameReducer(resolved, { type: 'TIME_EXPIRED' })).toBe(resolved)
  })
})

describe('gameReducer — last-module win lock', () => {
  it('solving the final daily module survives a racing TIME_EXPIRED', () => {
    // Daily run on the last module (index 3 of 4), still PLAYING.
    const playing = baseState({ mode: 'daily', status: 'PLAYING', currentModuleIndex: 3 })

    // The final module is solved.
    const afterComplete = gameReducer(playing, {
      type: 'MODULE_COMPLETE',
      moduleType: 'keypad',
    })
    expect(afterComplete.status).toBe('MODULE_COMPLETE')
    expect(afterComplete.outcome).toBe('defused')
    expect(afterComplete.totalEndTime).not.toBeNull()

    // The countdown hits zero inside the 800ms MODULE_COMPLETE → ALL_COMPLETE
    // auto-advance window. The already-won run must NOT become exploded.
    const afterExpire = gameReducer(afterComplete, { type: 'TIME_EXPIRED' })
    expect(afterExpire).toBe(afterComplete) // no-op
    expect(afterExpire.outcome).toBe('defused')
    expect(afterExpire.status).not.toBe('EXPLODING')
  })

  it('a non-final module solve leaves the run unresolved (timeout can still explode)', () => {
    const playing = baseState({ mode: 'daily', status: 'PLAYING', currentModuleIndex: 1 })
    const afterComplete = gameReducer(playing, { type: 'MODULE_COMPLETE', moduleType: 'dial' })
    expect(afterComplete.outcome).toBeNull()
    expect(afterComplete.totalEndTime).toBeNull()

    const afterExpire = gameReducer(afterComplete, { type: 'TIME_EXPIRED' })
    expect(afterExpire.status).toBe('EXPLODING')
    expect(afterExpire.outcome).toBe('exploded')
  })
})

describe('gameReducer — MODULE_COMPLETE terminal-state guard', () => {
  it('is a no-op once the run has left PLAYING (a racing solve cannot revive it)', () => {
    // A correct answer tapped inside the 1.4s explosion-animation window must
    // not flip an already-lost run back into a win. RESULT is guarded too.
    const exploding = baseState({ status: 'EXPLODING', outcome: 'exploded', totalEndTime: 123 })
    expect(gameReducer(exploding, { type: 'MODULE_COMPLETE', moduleType: 'keypad' })).toBe(
      exploding
    )

    const result = baseState({ status: 'RESULT', outcome: 'exploded', totalEndTime: 123 })
    expect(gameReducer(result, { type: 'MODULE_COMPLETE', moduleType: 'keypad' })).toBe(result)
  })
})

describe('gameReducer — NEXT_MODULE (module-sequence generalisation)', () => {
  it('practice (2 modules): advances to module 2, then completes the run', () => {
    const onFirst = baseState({
      mode: 'practice',
      status: 'MODULE_COMPLETE',
      moduleSequence: ['wire', 'keypad'],
      moduleConfigs: [null, null],
      moduleAnswers: [null, null],
      currentModuleIndex: 0,
    })
    const advanced = gameReducer(onFirst, { type: 'NEXT_MODULE' })
    expect(advanced.status).toBe('PLAYING')
    expect(advanced.currentModuleIndex).toBe(1)

    const onLast = { ...advanced, status: 'MODULE_COMPLETE' as const }
    const finished = gameReducer(onLast, { type: 'NEXT_MODULE' })
    expect(finished.status).toBe('ALL_COMPLETE')
  })

  it('daily (4 modules): the 4th module completes the run', () => {
    const onLast = baseState({
      status: 'MODULE_COMPLETE',
      currentModuleIndex: 3,
    })
    const finished = gameReducer(onLast, { type: 'NEXT_MODULE' })
    expect(finished.status).toBe('ALL_COMPLETE')
  })

  it('is a no-op when not in MODULE_COMPLETE (guards stale dispatch onto EXPLODING)', () => {
    const exploding = baseState({ status: 'EXPLODING', outcome: 'exploded' })
    expect(gameReducer(exploding, { type: 'NEXT_MODULE' })).toBe(exploding)
  })
})

describe('gameReducer — EXPLOSION_DONE / ALL_MODULES_COMPLETE', () => {
  it('EXPLOSION_DONE moves EXPLODING → RESULT', () => {
    const exploding = baseState({ status: 'EXPLODING', outcome: 'exploded', totalEndTime: 123 })
    expect(gameReducer(exploding, { type: 'EXPLOSION_DONE' }).status).toBe('RESULT')
  })

  it('ALL_MODULES_COMPLETE writes the success outcome per mode', () => {
    const dailyDone = gameReducer(baseState({ status: 'ALL_COMPLETE' }), {
      type: 'ALL_MODULES_COMPLETE',
    })
    expect(dailyDone.status).toBe('RESULT')
    expect(dailyDone.outcome).toBe('defused')

    const practiceDone = gameReducer(
      baseState({ status: 'ALL_COMPLETE', mode: 'practice', moduleSequence: ['wire', 'keypad'] }),
      { type: 'ALL_MODULES_COMPLETE' }
    )
    expect(practiceDone.outcome).toBe('practice-cleared')
  })
})

describe('gameReducer — failure telemetry', () => {
  // Calls to the mocked logEvent for a given event name. The mock accumulates
  // across the whole file, so each test in this block clears it first.
  const callsFor = (name: string) => vi.mocked(logEvent).mock.calls.filter((c) => c[0] === name)

  beforeEach(() => {
    vi.mocked(logEvent).mockClear()
  })

  it('daily: the 3rd MODULE_ERROR emits game_failed_strikeout exactly once', () => {
    let s = baseState({ mode: 'daily', status: 'PLAYING' })

    s = gameReducer(s, { type: 'MODULE_ERROR' })
    s = gameReducer(s, { type: 'MODULE_ERROR' })
    // The first two strikes do not detonate — no failure event yet.
    expect(callsFor('game_failed_strikeout')).toHaveLength(0)

    s = gameReducer(s, { type: 'MODULE_ERROR' })
    expect(s.status).toBe('EXPLODING')
    expect(callsFor('game_failed_strikeout')).toHaveLength(1)
    expect(callsFor('game_failed_strikeout')[0][1]).toMatchObject({
      mode: 'daily',
      attemptNumber: 1,
      strikeCount: MAX_STRIKES,
      moduleIndex: 0,
      moduleStats: [],
    })
  })

  it('daily: TIME_EXPIRED emits game_failed_timeout exactly once', () => {
    const s = baseState({ mode: 'daily', status: 'PLAYING' })
    const after = gameReducer(s, { type: 'TIME_EXPIRED' })

    expect(after.status).toBe('EXPLODING')
    expect(callsFor('game_failed_timeout')).toHaveLength(1)
    expect(callsFor('game_failed_timeout')[0][1]).toMatchObject({
      mode: 'daily',
      attemptNumber: 1,
      strikeCount: 0,
      moduleIndex: 0,
    })
  })

  it('practice: TIME_EXPIRED emits neither failure event', () => {
    const s = baseState({
      mode: 'practice',
      status: 'PLAYING',
      moduleSequence: ['wire', 'keypad'],
    })
    gameReducer(s, { type: 'TIME_EXPIRED' })

    expect(callsFor('game_failed_strikeout')).toHaveLength(0)
    expect(callsFor('game_failed_timeout')).toHaveLength(0)
  })

  it('does not double-emit when an already-EXPLODING run is re-entered', () => {
    // A racing MODULE_ERROR / TIME_EXPIRED landing after detonation hits the
    // terminal-state guards and no-ops — it must not emit a second event.
    const exploded = baseState({
      mode: 'daily',
      status: 'EXPLODING',
      outcome: 'exploded',
      strikeCount: MAX_STRIKES,
      totalEndTime: 1_700_000_000_123,
    })
    gameReducer(exploded, { type: 'MODULE_ERROR' })
    gameReducer(exploded, { type: 'TIME_EXPIRED' })

    expect(callsFor('game_failed_strikeout')).toHaveLength(0)
    expect(callsFor('game_failed_timeout')).toHaveLength(0)
  })
})
