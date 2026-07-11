/**
 * B4 winnability net + engine-agreement cross-check.
 *
 * For every shipped level: (1) brute-force the max achievable score under the
 * level's scarcity and assert it is >= target (a level whose target is
 * unreachable under its own pools would fail here and never ship); (2) play the
 * optimal placement through the REAL GameSession and assert the engine's own
 * score equals the brute-forced max and the win fires — proving the
 * presentation reachability model and the engine agree.
 */

import { describe, expect, it } from 'vitest'
import { GameSession } from '@amiclaw/creation'
import { buildLevel, elementId } from './build-level'
import { SOUND_GARDEN_GAME_TYPE } from './gametype'
import { LEVELS } from './levels'
import { bestPlacement } from './reachability'

describe('level reachability (winnability net)', () => {
  for (const cfg of LEVELS) {
    it(`Lv${cfg.index} · ${cfg.name}: max achievable score >= target`, () => {
      const best = bestPlacement(cfg)
      expect(best.score).toBeGreaterThanOrEqual(cfg.target)
    })

    it(`Lv${cfg.index} · ${cfg.name}: the engine agrees the optimal placement wins`, () => {
      const best = bestPlacement(cfg)
      const level = buildLevel(cfg)
      const session = new GameSession(SOUND_GARDEN_GAME_TYPE, level)

      for (const pair of best.pairs) {
        const r = session.performAction('rhythm_builder', 'place_piece', {
          element_id: elementId('r', pair.rhythmType, pair.slot),
        })
        const m = session.performAction('melody_builder', 'place_piece', {
          element_id: elementId('m', pair.melodyType, pair.slot),
        })
        expect(r.ok).toBe(true)
        expect(m.ok).toBe(true)
      }

      // The engine's own scoring must equal the brute-forced maximum.
      expect(session.score()).toBe(best.score)
      expect(session.isWon()).toBe(true)
    })
  }
})
