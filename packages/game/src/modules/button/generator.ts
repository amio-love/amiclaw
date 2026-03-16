import type { ButtonConfig, ButtonAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import type { Rng } from '../../engine/rng'
import { solveButton } from './solver'

const COLORS = ['red', 'blue', 'yellow', 'white']
const LABELS = ['ABORT', 'DETONATE', 'HOLD', 'PRESS']

export function generateButton(
  rng: Rng,
  rules: ManualModules['button']['rules'],
  sceneInfo: SceneInfo,
): { config: ButtonConfig; answer: ButtonAnswer } {
  for (let attempt = 0; attempt < 100; attempt++) {
    const config: ButtonConfig = {
      color: rng.pick(COLORS),
      label: rng.pick(LABELS),
      indicatorColor: rng.pick(COLORS),
      displayNumber: rng.intBetween(1, 9),
    }
    const answer = solveButton(config, rules, sceneInfo)
    if (answer !== null) return { config, answer }
  }
  throw new Error('Button generator exhausted 100 attempts')
}
