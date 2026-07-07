// Three-coin casting engine — the real-randomness seam behind PageCasting.
//
// One throw = three independent fair coins (heads 字 = 3, tails 背 = 2), so the
// yao values land with the canonical probabilities:
//   6 老阴 (3 tails)  1/8 · 7 少阳 (1 head) 3/8 · 8 少阴 (2 heads) 3/8 · 9 老阳 (3 heads) 1/8
// Randomness source: crypto.getRandomValues — one byte per throw, low 3 bits
// = the three coins. Injectable for deterministic tests.

import { coinsToYao, type CoinSide, type YaoValue } from './glyphs/utils'

export interface CoinThrow {
  /** The three coin faces, in dish order. */
  sides: readonly CoinSide[]
  /** The yao value the throw resolves to (6 / 7 / 8 / 9). */
  value: YaoValue
}

/** Draw one uniformly random byte from the platform CSPRNG. */
function cryptoRandomByte(): number {
  const buf = new Uint8Array(1)
  crypto.getRandomValues(buf)
  return buf[0]
}

/** Perform one three-coin throw. `randomByte` must return a uniform 0..255. */
export function castThrow(randomByte: () => number = cryptoRandomByte): CoinThrow {
  const bits = randomByte() & 0b111
  const sides: CoinSide[] = [0, 1, 2].map((i) => (((bits >> i) & 1) === 1 ? 'heads' : 'tails'))
  return { sides, value: coinsToYao(sides) }
}
