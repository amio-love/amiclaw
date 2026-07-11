import { describe, expect, it } from 'vitest'

import { RUN_CAP_TICKS } from './config'
import { hasLineOfSight } from './line-of-sight'
import { getMap } from './maps'
import { advance } from './reducer'
import { isWalkable } from './rules'
import { createRunningState } from './rules'
import type { Direction, QueuedAction } from './types'

const DIRECTIONS: Direction[] = ['up', 'left', 'right', 'down']
const RANDOM_TRACE_TICKS = 240

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
      while (state.phase === 'running' && state.tick < RANDOM_TRACE_TICKS) {
        const direction = DIRECTIONS[random() % DIRECTIONS.length]
        const actions: QueuedAction[] = [
          {
            applyAtTick: state.tick + 1,
            sequence: state.tick + 1,
            action: { type: 'player-move', direction },
          },
        ]
        const previousTick = state.tick
        const previousPursuer = { ...state.actors.pursuer.position }
        state = advance(state, actions)
        expect(state.tick).toBe(previousTick + 1)
        const map = getMap(state.mapId)
        expect(isWalkable(map, state.actors.player.position)).toBe(true)
        expect(isWalkable(map, state.actors.companion.position)).toBe(true)
        expect(isWalkable(map, state.actors.pursuer.position)).toBe(true)
        expect(
          Math.abs(previousPursuer.x - state.actors.pursuer.position.x) +
            Math.abs(previousPursuer.y - state.actors.pursuer.position.y)
        ).toBeLessThanOrEqual(2)
        expect(['player', 'moon-gate']).toContain(state.actors.pursuer.destination)
        if (state.actors.pursuer.destination !== 'moon-gate') {
          const destination = state.actors[state.actors.pursuer.destination]
          expect(destination.status).toBe('free')
          expect(hasLineOfSight(map, state.actors.pursuer.position, destination.position)).toBe(
            true
          )
        }
        const nextCollected = state.objectives.filter((objective) => objective.collected).length
        expect(nextCollected).toBeGreaterThanOrEqual(collected)
        collected = nextCollected
        expect(state.tick).toBeLessThanOrEqual(RUN_CAP_TICKS)
      }
      if (state.phase === 'running') {
        state.tick = RUN_CAP_TICKS - 1
        state = advance(state, [])
      }
      expect(['win', 'loss', 'timeout']).toContain(state.phase)
    }
  }, 30_000)
})
