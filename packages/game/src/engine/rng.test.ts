import { describe, it, expect } from 'vitest'
import { createRng } from './rng'

describe('createRng', () => {
  it('is deterministic — same seed produces same sequence', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 20; i++) {
      expect(a.float()).toBe(b.float())
    }
  })

  it('different seeds produce different sequences', () => {
    const a = createRng(42)
    const b = createRng(43)
    const aVals = Array.from({ length: 10 }, () => a.float())
    const bVals = Array.from({ length: 10 }, () => b.float())
    expect(aVals).not.toEqual(bVals)
  })

  it('intBetween stays within bounds over 1000 calls', () => {
    const rng = createRng(42)
    for (let i = 0; i < 1000; i++) {
      const v = rng.intBetween(1, 6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  it('intBetween covers the full range given enough calls', () => {
    const rng = createRng(42)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) seen.add(rng.intBetween(1, 6))
    expect(seen.size).toBe(6)
  })

  it('pick returns an element from the array', () => {
    const rng = createRng(42)
    const arr = ['a', 'b', 'c', 'd']
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rng.pick(arr))
    }
  })

  it('shuffle returns a permutation of the same elements', () => {
    const rng = createRng(42)
    const arr = [1, 2, 3, 4, 5]
    const shuffled = rng.shuffle(arr)
    expect(shuffled).toHaveLength(arr.length)
    expect(shuffled.sort()).toEqual([...arr].sort())
  })

  it('shuffle does not mutate the input array', () => {
    const rng = createRng(42)
    const arr = [1, 2, 3, 4, 5]
    const copy = [...arr]
    rng.shuffle(arr)
    expect(arr).toEqual(copy)
  })
})
