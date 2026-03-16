import { describe, it, expect } from 'vitest'
import { solveDial } from './solver'
import { generateDial } from './generator'
import { createRng } from '../../engine/rng'
import type { DialConfig, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'

const section: ManualModules['symbol_dial'] = {
  columns: [
    ['omega', 'psi', 'star', 'delta', 'xi', 'diamond'],
    ['psi', 'diamond', 'omega', 'star', 'xi', 'delta'],
    ['star', 'xi', 'delta', 'psi', 'diamond', 'omega'],
  ],
  rule: 'Find column containing all 3 symbols',
}

const sceneInfo: SceneInfo = {
  serialNumber: 'TEST001',
  batteryCount: 2,
  indicators: [],
}

describe('solveDial', () => {
  it('finds the correct column and returns target positions', () => {
    // Config with symbols: omega (at 0), psi (at 0), star (at 0)
    // All three symbols are in column 0, at indices 0, 1, 2
    const config: DialConfig = {
      dials: [
        ['omega', 'delta', 'psi', 'xi', 'diamond', 'star'],
        ['psi', 'star', 'diamond', 'omega', 'xi', 'delta'],
        ['star', 'diamond', 'omega', 'psi', 'xi', 'delta'],
      ],
      currentPositions: [0, 0, 0],
    }

    const answer = solveDial(config, section, sceneInfo)

    expect(answer).not.toBeNull()
    expect(answer?.type).toBe('dial')
    expect(answer?.positions).toEqual([0, 1, 2])
  })

  it('returns null when no column contains all 3 symbols', () => {
    // 'trident' does not appear in any of the 3 test columns → no match
    const config: DialConfig = {
      dials: [
        ['omega', 'delta', 'psi', 'xi', 'diamond', 'star'],
        ['psi', 'star', 'diamond', 'omega', 'xi', 'delta'],
        ['trident', 'crescent', 'spiral', 'cross', 'eye', 'lambda'],
      ],
      currentPositions: [0, 0, 0],
    }

    const answer = solveDial(config, section, sceneInfo)
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
})
