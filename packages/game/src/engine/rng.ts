/**
 * Seeded PRNG using mulberry32 algorithm.
 * Practice mode: use seed 42. Daily challenge: use Date.now() at game start.
 */
export function createRng(seed: number) {
  let s = seed >>> 0

  function next(): number {
    s += 0x6d2b79f5
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    /** Returns a float in [0, 1) */
    float: (): number => next(),

    /** Returns an integer in [min, max] inclusive */
    intBetween: (min: number, max: number): number =>
      Math.floor(next() * (max - min + 1)) + min,

    /** Picks a random element from an array */
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],

    /** Returns a new shuffled copy of the array (Fisher-Yates) */
    shuffle: <T>(arr: readonly T[]): T[] => {
      const result = [...arr]
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]]
      }
      return result
    },
  }
}

export type Rng = ReturnType<typeof createRng>
