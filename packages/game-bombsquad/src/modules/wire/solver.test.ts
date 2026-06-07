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
  { condition: { wire_count: 5 }, action: 'cut_wire', target: { position: 3 } },
  // Fallback
  { condition: {}, action: 'cut_wire', target: { position: 'first' } },
]

describe('solveWire', () => {
  it('matches rule by color_at_last', () => {
    const config = {
      wires: [
        { color: 'blue' as const },
        { color: 'yellow' as const },
        { color: 'green' as const },
        { color: 'red' as const },
      ],
    }
    const answer = solveWire(config, rules, sceneInfo)
    expect(answer).toEqual({ type: 'wire', cutPosition: 3 })
  })

  it('returns null when no rule matches (empty rules)', () => {
    const config = { wires: [{ color: 'red' as const }] }
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

// Pins the contract that wire `target.position` integers are 1-indexed
// top-down, and `resolvePosition` maps integer N → 0-indexed array index N-1
// for 1 ≤ N ≤ length (else null). Each case is written so that reverting the
// numeric branch to the old 0-indexed `return n >= 0 && n < length ? n : null`
// would FAIL it. Fixtures are local and self-contained — they do not touch the
// file-level `rules` used by the suites above.
describe('solveWire — numeric position (1-indexed → 0-indexed)', () => {
  const fourWires = {
    wires: [
      { color: 'blue' as const },
      { color: 'yellow' as const },
      { color: 'green' as const },
      { color: 'white' as const },
    ],
  }

  it('position 1 cuts the topmost wire → cutPosition 0', () => {
    // New solver: 1 - 1 = 0. Old `return n`: 1. Expect 0 → old solver fails.
    const numericRules: WireRule[] = [
      { condition: { wire_count: 4 }, action: 'cut_wire', target: { position: 1 } },
    ]
    expect(solveWire(fourWires, numericRules, sceneInfo)).toEqual({
      type: 'wire',
      cutPosition: 0,
    })
  })

  it('position 3 on a 4-wire config cuts the 3rd wire from top → cutPosition 2', () => {
    // New solver: 3 - 1 = 2. Old `return n`: 3. Expect 2 → old solver fails.
    const numericRules: WireRule[] = [
      { condition: { wire_count: 4 }, action: 'cut_wire', target: { position: 3 } },
    ]
    expect(solveWire(fourWires, numericRules, sceneInfo)).toEqual({
      type: 'wire',
      cutPosition: 2,
    })
  })

  it('position === wire count cuts the bottommost wire (last ≡ position length) → cutPosition length-1', () => {
    // position 4 on a 4-wire config. New solver: 4 - 1 = 3 (= length - 1).
    // Old `return n`: 4 (out of range). Expect 3 → old solver fails.
    const numericRules: WireRule[] = [
      { condition: { wire_count: 4 }, action: 'cut_wire', target: { position: 4 } },
    ]
    const lastRule: WireRule[] = [
      { condition: { wire_count: 4 }, action: 'cut_wire', target: { position: 'last' } },
    ]
    expect(solveWire(fourWires, numericRules, sceneInfo)).toEqual({
      type: 'wire',
      cutPosition: fourWires.wires.length - 1,
    })
    // position length and 'last' resolve to the same index.
    expect(solveWire(fourWires, numericRules, sceneInfo)).toEqual(
      solveWire(fourWires, lastRule, sceneInfo)
    )
  })

  it('invalid position 0 is skipped (no longer a valid 1-indexed target) → falls through to next rule', () => {
    // New solver: 0 < 1 → null → continue → fallback 'last' resolves to 3.
    // Old solver: 0 is in range → returns cutPosition 0 immediately, never
    // falling through. Expect 3 → old solver fails.
    const withFallback: WireRule[] = [
      { condition: { wire_count: 4 }, action: 'cut_wire', target: { position: 0 } },
      { condition: {}, action: 'cut_wire', target: { position: 'last' } },
    ]
    expect(solveWire(fourWires, withFallback, sceneInfo)).toEqual({
      type: 'wire',
      cutPosition: 3,
    })

    // With no fallback rule, the unresolvable numeric rule yields null overall.
    const noFallback: WireRule[] = [
      { condition: { wire_count: 4 }, action: 'cut_wire', target: { position: 0 } },
    ]
    expect(solveWire(fourWires, noFallback, sceneInfo)).toBeNull()
  })

  it('invalid position length+1 is skipped → null (out-of-range high rejected)', () => {
    // position 5 on a 4-wire config. New solver: 5 > 4 → null. (Both old and
    // new reject this high out-of-range value; this case pins the upper bound.)
    const noFallback: WireRule[] = [
      { condition: { wire_count: 4 }, action: 'cut_wire', target: { position: 5 } },
    ]
    expect(solveWire(fourWires, noFallback, sceneInfo)).toBeNull()
  })
})
