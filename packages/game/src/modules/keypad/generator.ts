import type { KeypadConfig, KeypadAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import type { Rng } from '../../engine/rng'
import { solveKeypad } from './solver'

export function generateKeypad(
  rng: Rng,
  section: ManualModules['keypad'],
  sceneInfo: SceneInfo,
): { config: KeypadConfig; answer: KeypadAnswer } {
  const allSymbols = [...new Set(section.sequences.flat())]

  for (let attempt = 0; attempt < 100; attempt++) {
    const symbols = rng.shuffle(allSymbols).slice(0, 4)
    const config: KeypadConfig = { symbols }
    const answer = solveKeypad(config, section, sceneInfo)
    if (answer !== null) return { config, answer }
  }
  throw new Error('Keypad generator exhausted 100 attempts')
}
