import type { DialConfig, DialAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import type { Rng } from '../../engine/rng'
import { solveDial } from './solver'

/**
 * Build a dial puzzle by picking a manual column, then drawing 3 distinct
 * starting symbols from it. Each physical dial is `[start, ...5 fillers]` —
 * still 6 symbols, so the DialModule UI is unchanged — but only the position-0
 * (current) symbol is meaningful to `solveDial`; the fillers are decoration.
 *
 * Because any two columns share at most 2 symbols, a 3-symbol subset of one
 * column cannot be a subset of another, so the three starts map back to
 * exactly one column. The three starts are pairwise distinct (drawn from a
 * column, which has no repeats), which lets an AI partner trust "I see
 * S1, S2, S3" as three distinct readings. The retry loop is a defensive
 * guard; with discriminating columns the first attempt already succeeds.
 */
export function generateDial(
  rng: Rng,
  section: ManualModules['symbol_dial'],
  sceneInfo: SceneInfo
): { config: DialConfig; answer: DialAnswer } {
  const allSymbols = [...new Set(section.columns.flat())]

  for (let attempt = 0; attempt < 100; attempt++) {
    // Pick 3 distinct starting symbols from one column; each dial holds its
    // start at index 0 followed by 5 fillers drawn from the remaining pool.
    const column = rng.pick(section.columns)
    const startingSymbols = rng.shuffle(column).slice(0, 3)
    const dials = startingSymbols.map((start) => {
      const rest = rng.shuffle(allSymbols.filter((s) => s !== start)).slice(0, 5)
      return [start, ...rest]
    })
    const currentPositions = [0, 0, 0]
    const config: DialConfig = { dials, currentPositions }
    const answer = solveDial(config, section, sceneInfo)
    if (answer !== null) return { config, answer }
  }
  throw new Error('Dial generator exhausted 100 attempts')
}
