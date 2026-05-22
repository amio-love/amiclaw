import { describe, it, expect } from 'vitest'
import { solveDial } from './solver'
import { generateDial } from './generator'
import { createRng } from '../../engine/rng'
import type { DialConfig, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'

// Discriminating columns: 5 symbols each, any two share at most 2 symbols, so
// every 3-symbol subset belongs to exactly one column. Drawn from the verified
// practice.yaml set.
const section: ManualModules['symbol_dial'] = {
  columns: [
    ['delta', 'star', 'diamond', 'trident', 'cross'],
    ['omega', 'xi', 'diamond', 'cross', 'hourglass'],
    ['psi', 'star', 'xi', 'crescent', 'hourglass'],
  ],
  rule: 'Find the one column containing all 3 symbols',
}

// The pre-fix ambiguous shape: two columns over one shared symbol set, so a
// 3-symbol subset is contained in both. The hardened solver must fail loud.
const ambiguousColumns: ManualModules['symbol_dial'] = {
  columns: [
    ['delta', 'star', 'diamond', 'trident', 'cross'],
    ['cross', 'trident', 'diamond', 'star', 'delta'],
  ],
  rule: 'Two columns over one shared symbol set',
}

const sceneInfo: SceneInfo = {
  sceneTongueTwister: '四是四十是十',
  batteryCount: 2,
  indicators: [],
}

describe('solveDial', () => {
  it('finds the correct column and returns target positions', () => {
    // Current symbols (position 0 of each dial): delta, star, diamond — a
    // subset of column 0 only, at indices 0, 1, 2.
    const config: DialConfig = {
      dials: [
        ['delta', 'omega', 'psi', 'xi', 'crescent', 'spiral'],
        ['star', 'omega', 'psi', 'xi', 'crescent', 'spiral'],
        ['diamond', 'omega', 'psi', 'xi', 'crescent', 'spiral'],
      ],
      currentPositions: [0, 0, 0],
    }

    const answer = solveDial(config, section, sceneInfo)

    expect(answer).not.toBeNull()
    expect(answer?.type).toBe('dial')
    expect(answer?.positions).toEqual([0, 1, 2])
  })

  it('returns null when no column contains all 3 symbols', () => {
    // 'spiral' does not appear in any of the 3 test columns → no match.
    const config: DialConfig = {
      dials: [
        ['delta', 'omega', 'psi', 'xi', 'crescent', 'cross'],
        ['star', 'omega', 'psi', 'xi', 'crescent', 'cross'],
        ['spiral', 'omega', 'psi', 'xi', 'crescent', 'cross'],
      ],
      currentPositions: [0, 0, 0],
    }

    const answer = solveDial(config, section, sceneInfo)
    expect(answer).toBeNull()
  })

  it('returns null when more than one column matches (ambiguous → fail loud)', () => {
    // {delta, star, diamond} is a subset of BOTH ambiguous columns.
    const config: DialConfig = {
      dials: [
        ['delta', 'omega', 'psi', 'xi', 'crescent', 'spiral'],
        ['star', 'omega', 'psi', 'xi', 'crescent', 'spiral'],
        ['diamond', 'omega', 'psi', 'xi', 'crescent', 'spiral'],
      ],
      currentPositions: [0, 0, 0],
    }

    const answer = solveDial(config, ambiguousColumns, sceneInfo)
    expect(answer).toBeNull()
  })
})

describe('generateDial', () => {
  it('generates 100 valid configs without throwing', () => {
    const rng = createRng(42)
    expect(() => {
      for (let i = 0; i < 100; i++) {
        generateDial(rng, section, sceneInfo)
      }
    }).not.toThrow()
  })

  it('is deterministic with the same seed', () => {
    const rng1 = createRng(42)
    const result1 = generateDial(rng1, section, sceneInfo)

    const rng2 = createRng(42)
    const result2 = generateDial(rng2, section, sceneInfo)

    expect(result1.config).toEqual(result2.config)
    expect(result1.answer).toEqual(result2.answer)
  })

  it('always produces 3 distinct starting symbols at position 0', () => {
    // Guards the invariant that lets an AI partner trust "I see S1, S2, S3"
    // as three distinct readings. Repeating the generator many times makes it
    // vanishingly unlikely for a duplicate-start regression to slip through.
    const rng = createRng(1)
    for (let i = 0; i < 200; i++) {
      const { config } = generateDial(rng, section, sceneInfo)
      const starts = config.dials.map((dial, d) => dial[config.currentPositions[d]])
      expect(new Set(starts).size).toBe(3)
    }
  })

  it('every generated config maps to exactly one column', () => {
    const rng = createRng(7)
    for (let i = 0; i < 200; i++) {
      const { config } = generateDial(rng, section, sceneInfo)
      const starts = config.dials.map((dial, d) => dial[config.currentPositions[d]])
      const matches = section.columns.filter((col) => starts.every((sym) => col.includes(sym)))
      expect(matches).toHaveLength(1)
    }
  })
})
