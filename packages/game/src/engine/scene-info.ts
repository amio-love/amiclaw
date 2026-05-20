import type { SceneInfo } from '@shared/manual-schema'
import type { Rng } from './rng'
import { TONGUE_TWISTERS } from '@/data/tongue-twisters'

/**
 * Indicator labels a scene can display. Sampled WITHOUT replacement per run
 * (see `generateSceneInfo`) — a bomb never carries two indicators with the
 * same label, and a duplicate would also silently overwrite itself in the
 * rule engine's `indicator_<label>_lit` context lookup.
 */
export const INDICATOR_LABELS = ['FRK', 'CAR', 'NSA', 'MSA', 'SND', 'CLR', 'BOB', 'TRN']

/**
 * Generate the puzzle-global scene info — the tongue-twister phrase, battery
 * count, and indicators — that every module's rules read against.
 *
 * Indicators are produced by shuffling the label pool and slicing the first
 * N, guaranteeing every indicator in a single scene has a unique label.
 */
export function generateSceneInfo(rng: Rng): SceneInfo {
  const sceneTongueTwister = rng.pick(TONGUE_TWISTERS)
  const batteryCount = rng.intBetween(1, 4)
  const indicatorCount = rng.intBetween(0, 3)
  const indicators = rng
    .shuffle(INDICATOR_LABELS)
    .slice(0, indicatorCount)
    .map((label) => ({
      label,
      lit: rng.float() < 0.5,
    }))
  return { sceneTongueTwister, batteryCount, indicators }
}
