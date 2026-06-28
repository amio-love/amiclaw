import { describe, it, expect } from 'vitest'
import type { Manual } from '@shared/manual-schema'
import type { ModuleKind } from '@/store/game-context'
import { bombsquadManualToManualData, moduleKindToRelevantSections } from './manual-data'

/** Every ModuleKind variant, used to assert exhaustive, non-empty mapping. */
const ALL_MODULE_KINDS: ModuleKind[] = ['wire', 'dial', 'button', 'keypad']

/** A minimal but schema-valid manual carrying all four real modules + a decoy. */
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
      button: {
        rules: [{ condition: { color: 'red' }, action: { type: 'tap' } }],
      },
      keypad: {
        sequences: [['psi', 'omega', 'lambda', 'sigma', 'theta', 'phi']],
        rule: 'keypad rule text',
      },
    },
    decoy_modules: {
      morse_code: { rule: 'a decoy module that must not leak into ManualData' },
    },
  }
}

describe('moduleKindToRelevantSections', () => {
  it('maps each ModuleKind to its real manual section id', () => {
    expect(moduleKindToRelevantSections('wire')).toEqual(['wire_routing'])
    expect(moduleKindToRelevantSections('dial')).toEqual(['symbol_dial'])
    expect(moduleKindToRelevantSections('button')).toEqual(['button'])
    expect(moduleKindToRelevantSections('keypad')).toEqual(['keypad'])
  })

  it('returns a non-empty array for every ModuleKind', () => {
    for (const kind of ALL_MODULE_KINDS) {
      expect(moduleKindToRelevantSections(kind).length).toBeGreaterThan(0)
    }
  })

  it('returns a fresh array each call (callers cannot mutate the shared mapping)', () => {
    const first = moduleKindToRelevantSections('wire')
    first.push('tampered')
    expect(moduleKindToRelevantSections('wire')).toEqual(['wire_routing'])
  })

  it('only references section ids that exist in the produced ManualData', () => {
    const manualData = bombsquadManualToManualData(makeManual(), 'v1')
    for (const kind of ALL_MODULE_KINDS) {
      for (const sectionId of moduleKindToRelevantSections(kind)) {
        expect(manualData.sections).toHaveProperty(sectionId)
      }
    }
  })
})

describe('bombsquadManualToManualData', () => {
  it('carries the supplied version through unchanged', () => {
    expect(bombsquadManualToManualData(makeManual(), '2026-06-28').version).toBe('2026-06-28')
  })

  it('keys sections by the real module-section ids', () => {
    const { sections } = bombsquadManualToManualData(makeManual(), 'v1')
    expect(Object.keys(sections).sort()).toEqual(
      ['button', 'keypad', 'symbol_dial', 'wire_routing'].sort()
    )
  })

  it('preserves each module section content verbatim', () => {
    const manual = makeManual()
    const { sections } = bombsquadManualToManualData(manual, 'v1')
    expect(sections.wire_routing).toEqual(manual.modules.wire_routing)
    expect(sections.symbol_dial).toEqual(manual.modules.symbol_dial)
    expect(sections.button).toEqual(manual.modules.button)
    expect(sections.keypad).toEqual(manual.modules.keypad)
  })

  it('excludes decoy_modules — only real modules are injected', () => {
    const { sections } = bombsquadManualToManualData(makeManual(), 'v1')
    expect(sections).not.toHaveProperty('morse_code')
  })

  it('does not mutate the source manual', () => {
    const manual = makeManual()
    const before = JSON.stringify(manual)
    bombsquadManualToManualData(manual, 'v1')
    expect(JSON.stringify(manual)).toBe(before)
  })
})
