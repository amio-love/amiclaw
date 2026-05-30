import { describe, it, expect, beforeEach } from 'vitest'
import { loadPersistedState, savePersistedState, clearPersistedState } from './persistence'
import type { GameState } from './game-context'

const sampleState: GameState = {
  status: 'PLAYING',
  mode: 'practice',
  manual: null,
  manualUrl: 'https://claw.amio.fans/manual/practice',
  sceneInfo: { sceneTongueTwister: '四是四十是十', batteryCount: 2, indicators: [] },
  moduleSequence: ['wire', 'keypad'],
  moduleConfigs: [null, null],
  moduleAnswers: [null, null],
  currentModuleIndex: 1,
  moduleStats: [{ moduleType: 'wire', timeMs: 12345, errorCount: 0 }],
  totalStartTime: 1_700_000_000_000,
  totalEndTime: null,
  currentModuleStartTime: 1_700_000_012_345,
  currentModuleErrorCount: 0,
  strikeCount: 0,
  timeBudgetMs: 300_000,
  outcome: null,
  errorMessage: null,
  errorKind: null,
  attemptNumber: 1,
  rngSeed: 42,
}

describe('persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    expect(loadPersistedState()).toBeNull()
  })

  it('round-trips a full GameState through sessionStorage', () => {
    savePersistedState(sampleState)
    const restored = loadPersistedState()
    expect(restored).toEqual(sampleState)
  })

  it('returns null when the stored value is corrupt JSON', () => {
    sessionStorage.setItem('bombsquad:game-state:v2', '{broken json')
    expect(loadPersistedState()).toBeNull()
  })

  it('round-trips an EXPLODING state so a refresh mid-explosion is recoverable', () => {
    const exploded: GameState = {
      ...sampleState,
      mode: 'daily',
      status: 'EXPLODING',
      moduleSequence: ['wire', 'dial', 'button', 'keypad'],
      moduleConfigs: [null, null, null, null],
      moduleAnswers: [null, null, null, null],
      strikeCount: 3,
      timeBudgetMs: 600_000,
      totalEndTime: 1_700_000_120_000,
      outcome: 'exploded',
    }
    savePersistedState(exploded)
    expect(loadPersistedState()).toEqual(exploded)
  })

  it('clearPersistedState removes the stored value', () => {
    savePersistedState(sampleState)
    expect(loadPersistedState()).not.toBeNull()
    clearPersistedState()
    expect(loadPersistedState()).toBeNull()
  })

  it('save -> load preserves Date.now()-based timers so a refresh continues the timer', () => {
    const state: GameState = { ...sampleState, totalStartTime: Date.now() - 30_000 }
    savePersistedState(state)
    const restored = loadPersistedState()
    expect(restored?.totalStartTime).toBe(state.totalStartTime)
    // A refresh here would read Date.now() and subtract totalStartTime to
    // produce an elapsed time ~30s, not 0 — which is the whole point.
  })
})
