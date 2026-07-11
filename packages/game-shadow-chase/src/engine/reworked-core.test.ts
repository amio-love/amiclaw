import { describe, expect, it } from 'vitest'

import { getMap } from './maps'
import { nextStepOnShortestPath } from './pathfinding'
import { pursuerStepPath } from './pursuer-policy'
import { advance } from './reducer'
import { createRunningState } from './rules'
import type { QueuedAction, SimulationState } from './types'

function action(
  state: SimulationState,
  sequence: number,
  value: QueuedAction['action']
): QueuedAction {
  return { applyAtTick: state.tick + 1, sequence, action: value }
}

describe('priority pursuit core', () => {
  it('opens the exit on the same tick that the player collects the third core', () => {
    const state = createRunningState('courtyard', 'relaxed', 17)
    state.tick = 70
    state.objectives[0].collected = true
    state.objectives[1].collected = true
    state.actors.player.position = { ...state.objectives[2].position }

    const next = advance(state, [], {
      companion: (current) => current.actors.companion.position,
      pursuer: (current) => current.actors.pursuer.position,
    })

    expect(next.tick).toBe(71)
    expect(next.objectives.every((objective) => objective.collected)).toBe(true)
    expect(next.exit.enabled).toBe(true)
  })

  it('keeps chasing the player through walls without a visibility state', () => {
    const state = createRunningState('courtyard', 'relaxed', 17)
    state.actors.pursuer.position = { x: 1, y: 5 }
    state.actors.player.position = { x: 1, y: 1 }

    expect(pursuerStepPath(state, 1)).toEqual([
      nextStepOnShortestPath(
        getMap(state.mapId),
        state.actors.pursuer.position,
        state.actors.player.position
      ),
    ])
    expect(state.actors.pursuer.destination).toBe('player')
  })

  it('switches to the companion only while the player is captured', () => {
    const state = createRunningState('courtyard', 'relaxed', 17)
    state.actors.player.status = 'captured'
    state.actors.companion.position = { x: 2, y: 1 }

    const next = advance(state, [], {
      companion: (current) => current.actors.companion.position,
      pursuer: pursuerStepPath,
    })

    expect(next.actors.pursuer.destination).toBe('companion')
  })

  it('switches back to the player immediately after a rescue', () => {
    const state = createRunningState('courtyard', 'relaxed', 17)
    state.actors.player.status = 'captured'
    state.actors.player.rescueDeadlineTick = 8
    state.actors.companion.position = { ...state.actors.player.position }
    state.actors.pursuer.position = { x: 6, y: 6 }

    const next = advance(state, [], {
      companion: (current) => current.actors.companion.position,
      pursuer: (current) => current.actors.pursuer.position,
    })

    expect(next.actors.player.status).toBe('free')
    expect(next.actors.pursuer.destination).toBe('player')
  })

  it('can capture the companion while it is the rescue target', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    state.actors.player.status = 'captured'
    state.actors.player.rescueDeadlineTick = 20
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.companion.position = { x: 3, y: 0 }

    const next = advance(state, [], {
      companion: (current) => current.actors.companion.position,
      pursuer: pursuerStepPath,
    })

    expect(next.actors.companion.status).toBe('captured')
    expect(next.phase).toBe('loss')
  })

  it('targets the player even when the companion is nearer', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 0, y: 0 }
    state.actors.companion.position = { x: 5, y: 0 }

    const next = advance(state, [])

    expect(next.actors.pursuer.destination).toBe('player')
  })

  it('moves an extra cell on an intense bonus tick without skipping player contact', () => {
    const state = createRunningState('crossroads', 'intense', 17)
    state.tick = 3
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 2, y: 0 }
    state.actors.companion.position = { x: 8, y: 8 }

    const next = advance(state, [])

    expect(next.actors.pursuer.position).toEqual({ x: 2, y: 0 })
    expect(next.actors.player.status).toBe('captured')
  })

  it('requires one collected core for each swap', () => {
    const state = Object.assign(createRunningState('courtyard', 'standard', 7), {
      swapCharges: 0,
    })
    const playerStart = { ...state.actors.player.position }
    const companionStart = { ...state.actors.companion.position }

    const rejected = advance(state, [action(state, 1, { type: 'swap' })])
    expect(rejected.actors.player.position).toEqual(playerStart)
    expect(rejected.actors.companion.position).toEqual(companionStart)
    expect(rejected.eventLog.at(-1)?.type).toBe('swap-rejected')

    rejected.actors.player.position = { ...rejected.objectives[0].position }
    rejected.actors.pursuer.position = { x: 5, y: 5 }
    const charged = advance(rejected, [], {
      companion: (current) => current.actors.companion.position,
      pursuer: (current) => current.actors.pursuer.position,
    }) as SimulationState & { swapCharges: number }
    expect(charged.swapCharges).toBe(1)

    const swapped = advance(charged, [action(charged, 2, { type: 'swap' })]) as SimulationState & {
      swapCharges: number
    }
    expect(swapped.swapCharges).toBe(0)
  })

  it('still captures the companion on incidental contact', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 0, y: 0 }
    state.actors.companion.position = { x: 3, y: 0 }

    const next = advance(state, [], {
      companion: (current) => current.actors.companion.position,
      pursuer: () => ({ x: 3, y: 0 }),
    })

    expect(next.actors.companion.status).toBe('captured')
    expect(next.actors.player.status).toBe('free')
  })

  it('does not let the companion collect a core or mint a swap charge', () => {
    const state = createRunningState('courtyard', 'standard', 17)
    state.actors.companion.position = { ...state.objectives[0].position }
    state.actors.pursuer.position = { x: 5, y: 5 }

    const next = advance(state, [], {
      companion: (current) => current.actors.companion.position,
      pursuer: (current) => current.actors.pursuer.position,
    })

    expect(next.objectives[0].collected).toBe(false)
    expect(next.swapCharges).toBe(0)
  })

  it('allows the companion to rescue while the live pursuer hunts it', () => {
    let state = createRunningState('courtyard', 'standard', 17)
    state.actors.player.position = { x: 2, y: 1 }
    state.actors.player.status = 'captured'
    state.actors.player.rescueDeadlineTick = 24
    state.actors.companion.position = { x: 0, y: 1 }
    state.actors.pursuer.position = { x: 2, y: 1 }

    while (
      state.phase === 'running' &&
      state.actors.player.status === 'captured' &&
      state.tick < 24
    ) {
      state = advance(state, [])
    }

    expect(
      state.eventLog.some((event) => event.type === 'rescue' && event.actorId === 'player')
    ).toBe(true)
    expect(state.phase).toBe('running')
    expect(state.actors.companion.status).toBe('free')
  })
})
