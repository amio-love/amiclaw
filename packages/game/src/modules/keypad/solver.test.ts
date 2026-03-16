import { describe, it, expect } from 'vitest'
import type { SceneInfo } from '@shared/manual-schema'
import { createRng } from '../../engine/rng'
import { solveKeypad } from './solver'
import { generateKeypad } from './generator'

const section = {
  sequences: [
    ['omega', 'delta', 'psi', 'xi', 'diamond', 'star'],
    ['star', 'xi', 'omega', 'delta', 'diamond', 'psi'],
    ['psi', 'diamond', 'star', 'omega', 'delta', 'xi'],
  ],
  rule: 'Find the sequence containing all 4 symbols and press in order',
}

const sceneInfo: SceneInfo = {
  serialNumber: 'A7K3B2',
  batteryCount: 2,
  indicators: [],
}

describe('solveKeypad', () => {
  it('solves with known symbols from sequence 0 and verifies sequence order', () => {
    const config = { symbols: ['omega', 'delta', 'psi', 'xi'] }
    const answer = solveKeypad(config, section, sceneInfo)

    expect(answer).not.toBeNull()
    if (answer) {
      expect(answer.type).toBe('keypad')
      expect(answer.sequence).toEqual([0, 1, 2, 3])
    }
  })

  it('returns null when no sequence contains all 4 symbols', () => {
    const config = { symbols: ['omega', 'delta', 'psi', 'nonexistent'] }
    const answer = solveKeypad(config, section, sceneInfo)

    expect(answer).toBeNull()
  })

  it('sequence length is always 4', () => {
    const config = { symbols: ['omega', 'delta', 'psi', 'xi'] }
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
})
