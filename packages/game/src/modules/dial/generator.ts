import type { DialConfig, DialAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import type { Rng } from '../../engine/rng'
import { solveDial } from './solver'

/**
 * Build a dial puzzle such that the three dials show THREE DISTINCT symbols
 * at position 0. The earlier generator shuffled each dial independently,
 * which occasionally produced two or three dials sharing the same starting
 * symbol. That is technically solvable (the solver just computes duplicate
 * target indices), but any reasonable LLM reading the manual will conclude
 * "a column contains each symbol at most once, so you cannot describe two
 * dials with the same symbol" and refuse to proceed. Guaranteeing distinct
 * starts removes the entire class of confusion without changing gameplay.
 */
export function generateDial(
  rng: Rng,
  section: ManualModules['symbol_dial'],
  sceneInfo: SceneInfo
): { config: DialConfig; answer: DialAnswer } {
  const allSymbols = [...new Set(section.columns.flat())]

  for (let attempt = 0; attempt < 100; attempt++) {
    // Pick 3 distinct starting symbols; each dial holds its start at index 0
    // followed by 5 other symbols drawn from the remaining pool.
    const startingSymbols = rng.shuffle(allSymbols).slice(0, 3)
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
