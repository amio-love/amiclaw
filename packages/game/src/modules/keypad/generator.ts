import type { KeypadConfig, KeypadAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import type { Rng } from '../../engine/rng'
import { solveKeypad } from './solver'

/**
 * Build a keypad puzzle by picking a manual sequence, then drawing a 4-symbol
 * visible subset from it. Because any two sequences share at most 3 symbols, a
 * 4-symbol subset of one sequence cannot be a subset of another — so the
 * subset maps back to exactly one sequence and `solveKeypad` resolves it.
 * The retry loop is a defensive guard; with discriminating sequences the first
 * attempt already yields a uniquely solvable config.
 */
export function generateKeypad(
  rng: Rng,
  section: ManualModules['keypad'],
  sceneInfo: SceneInfo
): { config: KeypadConfig; answer: KeypadAnswer } {
  for (let attempt = 0; attempt < 100; attempt++) {
    const sequence = rng.pick(section.sequences)
    const symbols = rng.shuffle(sequence).slice(0, 4)
    const config: KeypadConfig = { symbols }
    const answer = solveKeypad(config, section, sceneInfo)
    if (answer !== null) return { config, answer }
  }
  throw new Error('Keypad generator exhausted 100 attempts')
}
