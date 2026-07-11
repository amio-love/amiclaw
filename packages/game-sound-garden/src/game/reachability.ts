/**
 * Winnability safety net (L2 arch note B4 / finding F5).
 *
 * The engine's solver is scarcity-blind (material counts are presentation-only,
 * F1), so nothing machine-confirms that a scarce level's `target` is even
 * reachable. This module brute-forces the max achievable score under the
 * level's own scarcity (per-type pool counts + one-piece-per-slot). The state
 * space is tiny — a handful of pieces per side — so exhaustive enumeration is
 * instant.
 *
 * Only same-slot rhythm×melody pairs score, and the matrix is slot-independent,
 * so max achievable score reduces to a max-weight matching between the rhythm
 * pool and the melody pool, capped at the slot count. A negative (incompatible)
 * pairing is never beneficial — leaving a piece unplaced scores 0 — so the
 * optimum drops traps rather than pairing them.
 */

import { RELATION_SCORES } from './constants'
import type { MelodyType, RhythmType } from './constants'
import type { HarmonyMatrix, LevelConfig, Pool } from './types'

export interface BestPair {
  rhythmType: RhythmType
  melodyType: MelodyType
  /** 1-based slot assignment (arbitrary distinct slot — scoring is slot-independent). */
  slot: number
}

export interface BestPlacement {
  score: number
  pairs: BestPair[]
}

function expandPool<T extends string>(pool: Pool): T[] {
  const instances: T[] = []
  for (const [type, count] of Object.entries(pool)) {
    for (let i = 0; i < (count ?? 0); i++) instances.push(type as T)
  }
  return instances
}

interface SubResult {
  score: number
  pairs: { rhythmType: RhythmType; melodyType: MelodyType }[]
}

function solve(
  melody: MelodyType[],
  mi: number,
  rhythmLeft: RhythmType[],
  slotsLeft: number,
  matrix: HarmonyMatrix
): SubResult {
  if (mi >= melody.length || slotsLeft === 0) return { score: 0, pairs: [] }
  const m = melody[mi]
  // Option A: leave this melody piece unplaced.
  let best = solve(melody, mi + 1, rhythmLeft, slotsLeft, matrix)
  // Option B: pair it with each distinct available rhythm type.
  const tried = new Set<RhythmType>()
  for (let ri = 0; ri < rhythmLeft.length; ri++) {
    const r = rhythmLeft[ri]
    if (tried.has(r)) continue
    tried.add(r)
    const gain = RELATION_SCORES[matrix[r][m]]
    const rest = rhythmLeft.slice(0, ri).concat(rhythmLeft.slice(ri + 1))
    const sub = solve(melody, mi + 1, rest, slotsLeft - 1, matrix)
    const total = gain + sub.score
    if (total > best.score) {
      best = { score: total, pairs: [{ rhythmType: r, melodyType: m }, ...sub.pairs] }
    }
  }
  return best
}

/** Max achievable score + one optimal placement for a level's scarcity. */
export function bestPlacement(cfg: LevelConfig): BestPlacement {
  const melody = expandPool<MelodyType>(cfg.melodyPool)
  const rhythm = expandPool<RhythmType>(cfg.rhythmPool)
  const result = solve(melody, 0, rhythm, cfg.slots, cfg.matrix)
  return {
    score: result.score,
    pairs: result.pairs.map((p, i) => ({ ...p, slot: i + 1 })),
  }
}
