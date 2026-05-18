import { describe, it, expect } from 'vitest'
import { matchValue, matchCondition } from './rule-engine'
import type { SceneInfo } from '@shared/manual-schema'

const sceneInfo: SceneInfo = {
  sceneTongueTwister: '四是四十是十',
  batteryCount: 3,
  indicators: [
    { label: 'FRK', lit: true },
    { label: 'CAR', lit: false },
  ],
}

describe('matchValue', () => {
  it('equality: exact match', () => expect(matchValue('red', 'red')).toBe(true))
  it('equality: mismatch', () => expect(matchValue('red', 'blue')).toBe(false))
  it('{gt} operator', () => {
    expect(matchValue({ gt: 2 }, 3)).toBe(true)
    expect(matchValue({ gt: 2 }, 2)).toBe(false)
  })
  it('{gte} operator', () => {
    expect(matchValue({ gte: 3 }, 3)).toBe(true)
    expect(matchValue({ gte: 3 }, 2)).toBe(false)
  })
  it('{lt} operator', () => expect(matchValue({ lt: 4 }, 3)).toBe(true))
  it('{lte} operator', () => expect(matchValue({ lte: 3 }, 3)).toBe(true))
  it('{odd: true} matches odd numbers', () => {
    expect(matchValue({ odd: true }, 3)).toBe(true)
    expect(matchValue({ odd: true }, 4)).toBe(false)
  })
  it('{even: true} matches even numbers', () => {
    expect(matchValue({ even: true }, 4)).toBe(true)
    expect(matchValue({ even: true }, 3)).toBe(false)
  })
  it('{present: true} checks existence', () => {
    expect(matchValue({ present: true }, 'something')).toBe(true)
    expect(matchValue({ present: true }, null)).toBe(false)
  })
})

describe('matchCondition', () => {
  it('matches wire_count exactly', () => {
    const config = {
      wires: [
        { color: 'red', hasStripe: false },
        { color: 'blue', hasStripe: false },
        { color: 'yellow', hasStripe: false },
        { color: 'green', hasStripe: false },
      ],
    }
    expect(matchCondition({ wire_count: 4 }, config, sceneInfo)).toBe(true)
    expect(matchCondition({ wire_count: 5 }, config, sceneInfo)).toBe(false)
  })

  it('matches battery_count with {gt}', () => {
    const config = {}
    expect(matchCondition({ battery_count: { gt: 2 } }, config, sceneInfo)).toBe(true)
    expect(matchCondition({ battery_count: { gt: 3 } }, config, sceneInfo)).toBe(false)
  })

  it('matches indicator lit status', () => {
    const config = {}
    expect(matchCondition({ indicator_FRK_lit: true }, config, sceneInfo)).toBe(true)
    expect(matchCondition({ indicator_CAR_lit: true }, config, sceneInfo)).toBe(false)
  })

  it('matches color_at_last', () => {
    const config = {
      wires: [
        { color: 'red', hasStripe: false },
        { color: 'blue', hasStripe: false },
      ],
    }
    expect(matchCondition({ color_at_last: 'blue' }, config, sceneInfo)).toBe(true)
  })

  it('all conditions must match (AND logic)', () => {
    const config = { wires: Array(4).fill({ color: 'red', hasStripe: false }) }
    expect(matchCondition({ wire_count: 4, battery_count: { gt: 2 } }, config, sceneInfo)).toBe(
      true
    )
    expect(matchCondition({ wire_count: 4, battery_count: { gt: 5 } }, config, sceneInfo)).toBe(
      false
    )
  })
})
