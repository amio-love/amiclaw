import { describe, it, expect } from 'vitest'
import type { SceneInfo } from '@shared/manual-schema'
import { createRng } from '../../engine/rng'
import { solveButton } from './solver'
import { generateButton } from './generator'

const rules = [
  { condition: { color: 'blue', label: 'ABORT' }, action: { type: 'hold' as const, release_on_light: 'white' } },
  { condition: { color: 'red' }, action: { type: 'tap' as const } },
  { condition: {}, action: { type: 'tap' as const } }, // fallback
]

const sceneInfo: SceneInfo = {
  serialNumber: 'A7K3B9',
  batteryCount: 3,
  indicators: [{ label: 'FRK', lit: true }],
}

describe('solveButton', () => {
  it('returns hold action with correct releaseOnColor for blue ABORT button', () => {
    const config = { color: 'blue', label: 'ABORT', indicatorColor: 'red', displayNumber: 1 }
    const answer = solveButton(config, rules, sceneInfo)
    expect(answer).toEqual({
      type: 'button',
      action: 'hold',
      releaseOnColor: 'white',
    })
  })

  it('returns tap action for red DETONATE button', () => {
    const config = { color: 'red', label: 'DETONATE', indicatorColor: 'blue', displayNumber: 2 }
    const answer = solveButton(config, rules, sceneInfo)
    expect(answer).toEqual({
      type: 'button',
      action: 'tap',
      releaseOnColor: undefined,
    })
  })

  it('returns null for empty rules', () => {
    const config = { color: 'blue', label: 'ABORT', indicatorColor: 'red', displayNumber: 1 }
    const answer = solveButton(config, [], sceneInfo)
    expect(answer).toBeNull()
  })

  it('returns tap action via fallback rule for yellow button with any label', () => {
    const config = { color: 'yellow', label: 'HOLD', indicatorColor: 'white', displayNumber: 3 }
    const answer = solveButton(config, rules, sceneInfo)
    expect(answer).toEqual({
      type: 'button',
      action: 'tap',
      releaseOnColor: undefined,
    })
  })
})

describe('generateButton', () => {
  it('generates 100 valid configs without throwing', () => {
    const rng = createRng(42)
    for (let i = 0; i < 100; i++) {
      expect(() => generateButton(rng, rules, sceneInfo)).not.toThrow()
    }
  })

  it('is deterministic with same seed', () => {
    const rng1 = createRng(42)
    const rng2 = createRng(42)

    const result1 = generateButton(rng1, rules, sceneInfo)
    const result2 = generateButton(rng2, rules, sceneInfo)

    expect(result1.config).toEqual(result2.config)
    expect(result1.answer).toEqual(result2.answer)
  })

  it('generates different results with different seeds', () => {
    const rng1 = createRng(42)
    const rng2 = createRng(99)

    const result1 = generateButton(rng1, rules, sceneInfo)
    const result2 = generateButton(rng2, rules, sceneInfo)

    // At least one field should differ
    expect(
      result1.config !== result2.config ||
      result1.answer !== result2.answer
    ).toBe(true)
  })
})
