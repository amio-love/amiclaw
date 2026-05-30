import { describe, it, expect } from 'vitest'
import type { SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import { createRng } from '../../engine/rng'
import { solveKeypad } from './solver'
import { generateKeypad } from './generator'

// Discriminating sequences: any two share at most 3 symbols, so every
// 4-symbol subset belongs to exactly one sequence. Drawn from the verified
// practice.yaml set.
const section: ManualModules['keypad'] = {
  sequences: [
    ['omega', 'delta', 'xi', 'diamond', 'crescent', 'spiral'],
    ['omega', 'psi', 'delta', 'star', 'diamond', 'cross'],
    ['delta', 'star', 'xi', 'trident', 'crescent', 'cross'],
  ],
  rule: 'Find the one sequence containing all 4 symbols and press in order',
}

// The pre-fix ambiguous shape: two sequences over one shared 6-symbol pool,
// so every 4-symbol subset is contained in both. The hardened solver must
// fail loud (return null) instead of silently picking the first match.
const ambiguousSection: ManualModules['keypad'] = {
  sequences: [
    ['omega', 'delta', 'psi', 'xi', 'diamond', 'star'],
    ['star', 'xi', 'omega', 'delta', 'diamond', 'psi'],
  ],
  rule: 'Two sequences over one shared symbol pool',
}

const sceneInfo: SceneInfo = {
  sceneTongueTwister: '四是四十是十',
  batteryCount: 2,
  indicators: [],
}

describe('solveKeypad', () => {
  it('solves a 4-symbol subset unique to one sequence and verifies press order', () => {
    // {omega, delta, xi, diamond} is a subset of sequence 0 only.
    const config = { symbols: ['omega', 'delta', 'xi', 'diamond'] }
    const answer = solveKeypad(config, section, sceneInfo)

    expect(answer).not.toBeNull()
    if (answer) {
      expect(answer.type).toBe('keypad')
      // Order in sequence 0: omega(0) delta(1) xi(2) diamond(3).
      expect(answer.sequence).toEqual([0, 1, 2, 3])
    }
  })

  it('returns null when no sequence contains all 4 symbols', () => {
    const config = { symbols: ['omega', 'delta', 'psi', 'nonexistent'] }
    const answer = solveKeypad(config, section, sceneInfo)

    expect(answer).toBeNull()
  })

  it('returns null when more than one sequence matches (ambiguous → fail loud)', () => {
    // {omega, delta, psi, xi} is a subset of BOTH ambiguous sequences.
    const config = { symbols: ['omega', 'delta', 'psi', 'xi'] }
    const answer = solveKeypad(config, ambiguousSection, sceneInfo)

    expect(answer).toBeNull()
  })

  it('sequence length is always 4', () => {
    const config = { symbols: ['omega', 'delta', 'xi', 'diamond'] }
    const answer = solveKeypad(config, section, sceneInfo)

    expect(answer).not.toBeNull()
    if (answer) {
      expect(answer.sequence).toHaveLength(4)
    }
  })
})

describe('generateKeypad', () => {
  it('generates 100 valid configs without throwing (seed 42)', () => {
    const rng = createRng(42)

    expect(() => {
      for (let i = 0; i < 100; i++) {
        generateKeypad(rng, section, sceneInfo)
      }
    }).not.toThrow()
  })

  it('is deterministic with same seed', () => {
    const rng1 = createRng(42)
    const rng2 = createRng(42)

    const result1 = generateKeypad(rng1, section, sceneInfo)
    const result2 = generateKeypad(rng2, section, sceneInfo)

    expect(result1.config.symbols).toEqual(result2.config.symbols)
    expect(result1.answer.sequence).toEqual(result2.answer.sequence)
  })

  it('every generated config maps to exactly one sequence', () => {
    const rng = createRng(7)
    for (let i = 0; i < 200; i++) {
      const { config } = generateKeypad(rng, section, sceneInfo)
      const matches = section.sequences.filter((seq) =>
        config.symbols.every((sym) => seq.includes(sym))
      )
      expect(matches).toHaveLength(1)
    }
  })
})
