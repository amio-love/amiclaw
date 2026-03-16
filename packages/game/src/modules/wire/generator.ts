import type { WireConfig, WireAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import type { Rng } from '../../engine/rng'
import { solveWire } from './solver'

const COLORS = ['red', 'blue', 'yellow', 'green', 'white', 'black'] as const

/**
 * Generates a random WireConfig that has exactly one valid answer.
 * Rejects and retries if the config is ambiguous. Max 100 attempts.
 */
export function generateWire(
  rng: Rng,
  rules: ManualModules['wire_routing']['rules'],
  sceneInfo: SceneInfo,
  wireCount: 4 | 5 = 4,
): { config: WireConfig; answer: WireAnswer } {
  for (let attempt = 0; attempt < 100; attempt++) {
    const wires = Array.from({ length: wireCount }, () => ({
      color: rng.pick(COLORS) as string,
      hasStripe: rng.float() < 0.3,
      stripeColor: rng.float() < 0.3 ? rng.pick(COLORS) as string : undefined,
    }))
    const config: WireConfig = { wires }
    const answer = solveWire(config, rules, sceneInfo)
    if (answer !== null) return { config, answer }
  }
  throw new Error('Wire generator exhausted 100 attempts — check manual rules coverage')
}
