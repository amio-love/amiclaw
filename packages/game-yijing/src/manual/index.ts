import type { HexagramEntry } from './schema'
import { manual } from './data'

export type * from './schema'
export { manual } from './data'
export { HEXAGRAMS } from './hexagrams'

const byNumber = new Map<number, HexagramEntry>(
  manual.hexagrams.map((entry) => [entry.number, entry])
)

/** Look up a hexagram's manual entry by its King Wen number.
 *  The manual carries the full 64-hexagram dataset, so every valid King Wen
 *  number (1..64) resolves; `undefined` only for out-of-range input. */
export function hexagramByNumber(kingWenNumber: number): HexagramEntry | undefined {
  return byNumber.get(kingWenNumber)
}
