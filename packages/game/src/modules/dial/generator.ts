import type { DialConfig, DialAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import type { Rng } from '../../engine/rng'
import { solveDial } from './solver'

export function generateDial(
  rng: Rng,
  section: ManualModules['symbol_dial'],
  sceneInfo: SceneInfo,
): { config: DialConfig; answer: DialAnswer } {
  const allSymbols = [...new Set(section.columns.flat())]

  for (let attempt = 0; attempt < 100; attempt++) {
    // Build 3 dials, each with 6 symbols from the pool
    const dials = Array.from({ length: 3 }, () => rng.shuffle(allSymbols).slice(0, 6))
    // Start at position 0 for each dial
    const currentPositions = [0, 0, 0]
    const config: DialConfig = { dials, currentPositions }
    const answer = solveDial(config, section, sceneInfo)
    if (answer !== null) return { config, answer }
  }
  throw new Error('Dial generator exhausted 100 attempts')
}
