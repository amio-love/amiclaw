import { describe, it, expect } from 'vitest'
import type { Manual } from '@shared/manual-schema'
import type { GameState } from '@/store/game-context'
import {
  deriveVoicePanelInputs,
  isPlatformVoicePartner,
  MODE2_PARTNER_VALUE,
} from './voice-panel-inputs'

/** A minimal but schema-valid manual carrying all four real modules. */
function makeManual(): Manual {
  return {
    meta: { version: '2026-06-28', type: 'daily' },
    modules: {
      wire_routing: {
        rules: [
          { condition: { wire_count: 4 }, action: 'cut_wire', target: { position: 'first' } },
        ],
      },
      symbol_dial: {
        columns: [['delta', 'star', 'diamond', 'trident', 'cross']],
        rule: 'dial rule text',
      },
      button: { rules: [{ condition: { color: 'red' }, action: { type: 'tap' } }] },
      keypad: {
        sequences: [['psi', 'omega', 'lambda', 'sigma', 'theta', 'phi']],
        rule: 'keypad rule text',
      },
    },
    decoy_modules: { morse_code: { rule: 'decoy' } },
  } as unknown as Manual
}

/** A daily-run game state at the given module index, with a loaded manual. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    status: 'PLAYING',
    mode: 'daily',
    manual: makeManual(),
    manualUrl: 'https://claw.amio.fans/manual/2026-06-28',
    gameRunId: 'run-default',
    sceneInfo: null,
    moduleSequence: ['wire', 'dial', 'button', 'keypad'],
    moduleConfigs: [],
    moduleAnswers: [],
    currentModuleIndex: 0,
    moduleStats: [],
    totalStartTime: null,
    totalEndTime: null,
    currentModuleStartTime: null,
    currentModuleErrorCount: 0,
    strikeCount: 0,
    timeBudgetMs: 0,
    outcome: null,
    errorMessage: null,
    errorKind: null,
    attemptNumber: 1,
    rngSeed: 0,
    ...overrides,
  }
}

describe('isPlatformVoicePartner (mode② gating)', () => {
  it('opts in only a daily run carrying ?partner=platform', () => {
    expect(isPlatformVoicePartner('daily', MODE2_PARTNER_VALUE)).toBe(true)
  })

  it('keeps a daily run mode① without the explicit signal', () => {
    expect(isPlatformVoicePartner('daily', null)).toBe(false)
    expect(isPlatformVoicePartner('daily', 'byo')).toBe(false)
    expect(isPlatformVoicePartner('daily', '')).toBe(false)
  })

  it('never opts in practice, even with the signal', () => {
    expect(isPlatformVoicePartner('practice', MODE2_PARTNER_VALUE)).toBe(false)
    expect(isPlatformVoicePartner('practice', null)).toBe(false)
  })
})

describe('deriveVoicePanelInputs (current module -> hook inputs)', () => {
  it('maps the current module kind to its relevantSections', () => {
    const dial = deriveVoicePanelInputs(makeState({ currentModuleIndex: 1 }))
    expect(dial?.gameState.relevantSections).toEqual(['symbol_dial'])
    expect(dial?.moduleKind).toBe('dial')

    const keypad = deriveVoicePanelInputs(makeState({ currentModuleIndex: 3 }))
    expect(keypad?.gameState.relevantSections).toEqual(['keypad'])
    expect(keypad?.moduleKind).toBe('keypad')
  })

  it('carries the manual version into manualData and excludes decoys', () => {
    const inputs = deriveVoicePanelInputs(makeState())
    expect(inputs?.manualData.version).toBe('2026-06-28')
    expect(Object.keys(inputs?.manualData.sections ?? {}).sort()).toEqual(
      ['button', 'keypad', 'symbol_dial', 'wire_routing'].sort()
    )
    expect(inputs?.manualData.sections).not.toHaveProperty('morse_code')
  })

  it('keeps a run-stable sessionKey across module advances so the panel never remounts', () => {
    const first = deriveVoicePanelInputs({
      ...makeState({ currentModuleIndex: 0 }),
      gameRunId: 'shared',
    })
    const second = deriveVoicePanelInputs({
      ...makeState({ currentModuleIndex: 1 }),
      gameRunId: 'shared',
    })
    // Same run (same gameRunId) → identical key as the module advances → one session.
    expect(first?.sessionKey).toBe('run-shared')
    expect(second?.sessionKey).toBe('run-shared')
    expect(first?.sessionKey).toBe(second?.sessionKey)
    expect(first?.gameRunId).toBe('shared')
    // But the per-module sections still change, so the hook can steer the session.
    expect(first?.gameState.relevantSections).toEqual(['wire_routing'])
    expect(second?.gameState.relevantSections).toEqual(['symbol_dial'])
  })

  it('gives a different run a different sessionKey (a genuinely new session)', () => {
    const runA = deriveVoicePanelInputs(makeState({ gameRunId: 'a' }))
    const runB = deriveVoicePanelInputs(makeState({ gameRunId: 'b' }))
    expect(runA?.sessionKey).toBe('run-a')
    expect(runB?.sessionKey).toBe('run-b')
    expect(runA?.sessionKey).not.toBe(runB?.sessionKey)
  })

  it('returns null until a manual is loaded', () => {
    expect(deriveVoicePanelInputs(makeState({ manual: null }))).toBeNull()
  })

  it('returns null until the run identity is available', () => {
    expect(deriveVoicePanelInputs(makeState({ gameRunId: null }))).toBeNull()
  })

  it('returns null when there is no current module kind', () => {
    expect(
      deriveVoicePanelInputs(makeState({ moduleSequence: [], currentModuleIndex: 0 }))
    ).toBeNull()
  })
})
