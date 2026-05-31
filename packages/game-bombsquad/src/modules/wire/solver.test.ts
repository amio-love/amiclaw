import { describe, it, expect } from 'vitest'
import { solveWire } from './solver'
import { generateWire } from './generator'
import { createRng } from '../../engine/rng'
import type { SceneInfo, WireRule } from '@shared/manual-schema'

const sceneInfo: SceneInfo = {
  sceneTongueTwister: '四是四十是十',
  batteryCount: 3,
  indicators: [{ label: 'FRK', lit: true }],
}

const rules: WireRule[] = [
  {
    condition: { wire_count: 4, color_at_last: 'red' },
    action: 'cut_wire',
    target: { position: 'last' },
  },
  {
    condition: { wire_count: 4, count_blue: { gt: 1 } },
    action: 'cut_wire',
    target: { position: 'first', color: 'blue' },
  },
  { condition: { wire_count: 5 }, action: 'cut_wire', target: { position: 2 } },
  // Fallback
  { condition: {}, action: 'cut_wire', target: { position: 'first' } },
]

describe('solveWire', () => {
  it('matches rule by color_at_last', () => {
    const config = {
      wires: [
        { color: 'blue' as const, hasStripe: false },
        { color: 'yellow' as const, hasStripe: false },
        { color: 'green' as const, hasStripe: false },
        { color: 'red' as const, hasStripe: false },
      ],
    }
    const answer = solveWire(config, rules, sceneInfo)
    expect(answer).toEqual({ type: 'wire', cutPosition: 3 })
  })

  it('returns null when no rule matches (empty rules)', () => {
    const config = { wires: [{ color: 'red' as const, hasStripe: false }] }
    expect(solveWire(config, [], sceneInfo)).toBeNull()
  })
})

describe('generateWire', () => {
  it('generates 100 valid configs without throwing', () => {
    const rng = createRng(42)
    for (let i = 0; i < 100; i++) {
      const { config, answer } = generateWire(rng, rules, sceneInfo)
      expect(answer).not.toBeNull()
      expect(answer.cutPosition).toBeGreaterThanOrEqual(0)
      expect(answer.cutPosition).toBeLessThan(config.wires.length)
    }
  })

  it('is deterministic with same seed', () => {
    const rules2 = [...rules]
    const { config: c1, answer: a1 } = generateWire(createRng(99), rules2, sceneInfo)
    const { config: c2, answer: a2 } = generateWire(createRng(99), rules2, sceneInfo)
    expect(c1).toEqual(c2)
    expect(a1).toEqual(a2)
  })
})
