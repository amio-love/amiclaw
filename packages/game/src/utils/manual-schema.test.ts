import { describe, expect, it } from 'vitest'
import { collectReferencedSymbols, validateManualSymbols, type Manual } from '@shared/manual-schema'
import { SYMBOLS } from '@shared/symbols'

function makeManual(overrides: Partial<Manual> = {}): Manual {
  return {
    meta: { version: 'test', type: 'practice' },
    modules: {
      wire_routing: { rules: [] },
      symbol_dial: {
        columns: [['omega', 'psi', 'star', 'delta', 'xi', 'diamond']],
        rule: '',
      },
      button: { rules: [] },
      keypad: {
        sequences: [['omega', 'psi', 'star', 'delta']],
        rule: '',
      },
    },
    ...overrides,
  }
}

describe('collectReferencedSymbols', () => {
  it('returns the union of dial columns and keypad sequences', () => {
    const manual = makeManual()
    const refs = collectReferencedSymbols(manual.modules)
    expect([...refs].sort()).toEqual(['delta', 'diamond', 'omega', 'psi', 'star', 'xi'])
  })
})

describe('validateManualSymbols', () => {
  it('passes when every referenced id is registered in SYMBOLS', () => {
    expect(() => validateManualSymbols(makeManual(), SYMBOLS)).not.toThrow()
  })

  it('throws when a dial-referenced id is not registered in SYMBOLS', () => {
    const manual = makeManual({
      modules: {
        wire_routing: { rules: [] },
        symbol_dial: {
          columns: [['omega', 'unknown_sym', 'star', 'delta', 'xi', 'diamond']],
          rule: '',
        },
        button: { rules: [] },
        keypad: {
          sequences: [['omega', 'psi', 'star', 'delta']],
          rule: '',
        },
      },
    })
    expect(() => validateManualSymbols(manual, SYMBOLS)).toThrow(/unknown_sym/)
  })

  it('throws when a keypad-referenced id is not registered in SYMBOLS', () => {
    const manual = makeManual({
      modules: {
        wire_routing: { rules: [] },
        symbol_dial: {
          columns: [['omega', 'psi', 'star', 'delta', 'xi', 'diamond']],
          rule: '',
        },
        button: { rules: [] },
        keypad: {
          sequences: [['omega', 'psi', 'star', 'fake_id']],
          rule: '',
        },
      },
    })
    expect(() => validateManualSymbols(manual, SYMBOLS)).toThrow(/fake_id/)
  })
})
