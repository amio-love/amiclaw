import type { HexagramEntry } from './schema'
import { demoManual } from './demo-data'

export type * from './schema'
export { demoManual, demoHexagram } from './demo-data'

/** Look up a hexagram's manual entry by its King Wen number.
 *  Returns undefined when the manual does not carry that hexagram — the
 *  current demo manual covers only 乾 #1 / 同人 #13 / 无妄 #25, so callers
 *  MUST handle the miss instead of assuming full 64-hexagram coverage. */
export function hexagramByNumber(kingWenNumber: number): HexagramEntry | undefined {
  return demoManual.hexagrams.find((entry) => entry.number === kingWenNumber)
}
