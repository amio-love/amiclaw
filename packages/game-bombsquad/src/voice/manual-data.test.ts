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
    symbols: {
      delta: { description: '等边三角形' },
      star: { description: '五角星' },
      diamond: { description: '菱形' },
      trident: { description: '三叉戟,易被误描述为叉子' },
      cross: { description: '十字' },
      psi: { description: 'U 形碗加竖线,易被误描述为三叉戟' },
      omega: { description: '马蹄铁形' },
      lambda: { description: '倒 V 形' },
      sigma: { description: 'Σ 形' },
      theta: { description: '椭圆中横线' },
      phi: { description: '圆加竖线' },
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

  it('preserves non-symbol module sections verbatim', () => {
    const manual = makeManual()
    const { sections } = bombsquadManualToManualData(manual, 'v1')
    expect(sections.wire_routing).toEqual(manual.modules.wire_routing)
    expect(sections.button).toEqual(manual.modules.button)
  })

  it('preserves symbol module fields and adds symbol_descriptions', () => {
    const manual = makeManual()
    const { sections } = bombsquadManualToManualData(manual, 'v1')
    // Original module fields ride through unchanged…
    expect(sections.symbol_dial).toMatchObject(manual.modules.symbol_dial)
    expect(sections.keypad).toMatchObject(manual.modules.keypad)
    // …plus the referenced symbols' visual descriptions.
    expect(sections.symbol_dial).toHaveProperty('symbol_descriptions')
    expect(sections.keypad).toHaveProperty('symbol_descriptions')
  })

  it('injects descriptions for every symbol referenced by symbol_dial', () => {
    const manual = makeManual()
    const { sections } = bombsquadManualToManualData(manual, 'v1')
    const descriptions = (sections.symbol_dial as { symbol_descriptions: Record<string, string> })
      .symbol_descriptions
    // The dial's single column references these five symbols.
    expect(Object.keys(descriptions).sort()).toEqual(
      ['cross', 'delta', 'diamond', 'star', 'trident'].sort()
    )
    // The disambiguation text (the whole point) survives intact.
    expect(descriptions.trident).toContain('易被误描述为叉子')
  })

  it('injects descriptions for every symbol referenced by keypad', () => {
    const manual = makeManual()
    const { sections } = bombsquadManualToManualData(manual, 'v1')
    const descriptions = (sections.keypad as { symbol_descriptions: Record<string, string> })
      .symbol_descriptions
    expect(Object.keys(descriptions).sort()).toEqual(
      ['lambda', 'omega', 'phi', 'psi', 'sigma', 'theta'].sort()
    )
    expect(descriptions.psi).toContain('易被误描述为三叉戟')
  })

  it('tolerates a manual with no top-level symbols block (empty descriptions)', () => {
    const manual = makeManual()
    delete manual.symbols
    const { sections } = bombsquadManualToManualData(manual, 'v1')
    expect((sections.symbol_dial as { symbol_descriptions: unknown }).symbol_descriptions).toEqual(
      {}
    )
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
