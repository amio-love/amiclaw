import { describe, expect, it } from 'vitest'
import { collectReferencedSymbols, validateManualSymbols, type Manual } from '@shared/manual-schema'
import yaml from 'js-yaml'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const REPO_ROOT = resolve(__dirname, '../../../..')
const PRACTICE_YAML = join(REPO_ROOT, 'packages/manual/data/practice.yaml')
const DAILY_DIR = join(REPO_ROOT, 'packages/manual/data/daily')

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
    symbols: {
      omega: { description: 'horseshoe' },
      psi: { description: 'forked fork' },
      star: { description: 'star' },
      delta: { description: 'triangle' },
      xi: { description: 'three lines' },
      diamond: { description: 'diamond' },
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
  it('passes when every referenced symbol has a non-empty description', () => {
    expect(() => validateManualSymbols(makeManual())).not.toThrow()
  })

  it('throws when a referenced symbol lacks a description entry', () => {
    const manual = makeManual({
      symbols: {
        // psi referenced in dial+keypad but missing here
        omega: { description: 'horseshoe' },
        star: { description: 'star' },
        delta: { description: 'triangle' },
        xi: { description: 'three lines' },
        diamond: { description: 'diamond' },
      },
    })
    expect(() => validateManualSymbols(manual)).toThrow(/psi/)
  })

  it('throws when a referenced symbol has an empty description', () => {
    const manual = makeManual()
    manual.symbols.psi = { description: '   ' }
    expect(() => validateManualSymbols(manual)).toThrow(/psi/)
  })

  it('throws when symbols block declares an unused entry', () => {
    const manual = makeManual()
    manual.symbols.crescent = { description: 'moon' }
    expect(() => validateManualSymbols(manual)).toThrow(/crescent/)
  })
})

describe('shipped manual YAMLs', () => {
  function loadYaml(path: string): Manual {
    return yaml.load(readFileSync(path, 'utf8')) as Manual
  }

  it('practice.yaml loads and validates against the symbols invariant', () => {
    const manual = loadYaml(PRACTICE_YAML)
    expect(manual.symbols).toBeDefined()
    expect(() => validateManualSymbols(manual)).not.toThrow()
  })

  it('every daily YAML loads and validates against the symbols invariant', () => {
    const dailyFiles = readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))
    expect(dailyFiles.length).toBeGreaterThan(0)
    for (const file of dailyFiles) {
      const manual = loadYaml(join(DAILY_DIR, file))
      expect(manual.symbols, `${file} missing symbols block`).toBeDefined()
      expect(() => validateManualSymbols(manual), `${file} validation failed`).not.toThrow()
    }
  })

  it('every shipped description calls out a canonical shape (basic sanity)', () => {
    const manual = loadYaml(PRACTICE_YAML)
    for (const [id, entry] of Object.entries(manual.symbols)) {
      expect(entry.description.length, `symbol ${id} description too short`).toBeGreaterThan(4)
    }
  })
})
