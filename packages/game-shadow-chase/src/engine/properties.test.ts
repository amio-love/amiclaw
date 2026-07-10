import { describe, expect, it } from 'vitest'

import { RUN_CAP_TICKS } from './config'
import { getMap } from './maps'
import { advance } from './reducer'
import { isWalkable } from './rules'
import { createRunningState } from './rules'
import type { Direction, QueuedAction } from './types'

const DIRECTIONS: Direction[] = ['up', 'left', 'right', 'down']

function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
}

describe('seeded engine properties', () => {
  it('keeps actors legal, objectives monotone, and every bounded run terminal', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const random = lcg(seed)
      let state = createRunningState('courtyard', 'relaxed', seed)
      let collected = 0
      while (state.phase === 'running') {
        const direction = DIRECTIONS[random() % DIRECTIONS.length]
        const actions: QueuedAction[] = [
          {
            applyAtTick: state.tick + 1,
            sequence: state.tick + 1,
            action: { type: 'player-move', direction },
          },
        ]
        const previousTick = state.tick
        state = advance(state, actions)
        expect(state.tick).toBe(previousTick + 1)
        const map = getMap(state.mapId)
        expect(isWalkable(map, state.actors.player.position)).toBe(true)
        expect(isWalkable(map, state.actors.companion.position)).toBe(true)
        expect(isWalkable(map, state.actors.pursuer.position)).toBe(true)
        const nextCollected = state.objectives.filter((objective) => objective.collected).length
        expect(nextCollected).toBeGreaterThanOrEqual(collected)
        collected = nextCollected
        expect(state.tick).toBeLessThanOrEqual(RUN_CAP_TICKS)
      }
      expect(['win', 'loss', 'timeout']).toContain(state.phase)
    }
  })
})
