import { describe, expect, it } from 'vitest'

import { getMap } from './maps'
import { nextStepOnShortestPath } from './pathfinding'
import {
  buildPursuerObservation,
  nextPursuerStep,
  pursuerStepPath,
  selectPursuerDecision,
  type PursuerObservation,
} from './pursuer-policy'
import { createRunningState } from './rules'

describe('player-only pursuer policy', () => {
  it('targets a visible player and ignores a nearer companion and private intent', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 0, y: 0 }
    state.actors.companion.position = { x: 5, y: 0 }
    state.command = { intent: 'anchor' }
    state.activeModelLease = {
      requestId: '00000000-0000-4000-8000-000000000001',
      acceptedTick: 0,
      expiryTick: 10,
      intent: 'anchor',
    }

    const decision = selectPursuerDecision(buildPursuerObservation(state))

    expect(decision).toEqual({ visibleCandidates: ['player'], destination: 'player' })
    expect(nextPursuerStep(buildPursuerObservation(state), decision)).toEqual({ x: 3, y: 0 })
  })

  it('returns to the moon gate when the player is hidden even if the companion is visible', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    state.actors.companion.position = { x: 7, y: 4 }
    const expected = nextStepOnShortestPath(
      getMap(state.mapId),
      state.actors.pursuer.position,
      state.exit.position
    )

    expect(pursuerStepPath(state, 1)).toEqual([expected])
    expect(state.actors.pursuer.destination).toBe('moon-gate')
  })

  it('returns to the moon gate after capturing the player', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 2, y: 0 }
    state.actors.player.status = 'captured'

    expect(selectPursuerDecision(buildPursuerObservation(state)).destination).toBe('moon-gate')
  })

  it('takes one step every tick and one bonus step at the difficulty interval', () => {
    const counts = (['relaxed', 'standard', 'intense'] as const).map((difficulty) => {
      const state = createRunningState('crossroads', difficulty, 17)
      state.actors.pursuer.position = { x: 4, y: 0 }
      state.actors.player.position = { x: 0, y: 0 }
      const interval = { relaxed: 8, standard: 6, intense: 4 }[difficulty]
      return [pursuerStepPath(state, 1).length, pursuerStepPath(state, interval).length]
    })

    expect(counts).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
    ])
  })

  it('builds a narrow observation without reading the companion or private fields', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    Object.defineProperty(state.actors, 'companion', {
      configurable: true,
      get: () => {
        throw new Error('forbidden companion read')
      },
    })
    for (const field of [
      'command',
      'activeModelLease',
      'difficulty',
      'objectives',
      'decisionEpoch',
      'eventLog',
      'playerNavigation',
      'rngState',
      'swapCharges',
    ] as const) {
      Object.defineProperty(state, field, {
        configurable: true,
        get: () => {
          throw new Error(`forbidden read: ${field}`)
        },
      })
    }

    expect(() => buildPursuerObservation(state)).not.toThrow()
  })

  it('keeps the pure selector isolated from poisoned private fields', () => {
    const observation = buildPursuerObservation(createRunningState('crossroads', 'standard', 17))
    const poisoned = { ...observation } as PursuerObservation & Record<string, unknown>
    for (const field of [
      'companion',
      'command',
      'modelLease',
      'difficulty',
      'objectives',
      'voice',
    ]) {
      Object.defineProperty(poisoned, field, {
        get: () => {
          throw new Error(`forbidden read: ${field}`)
        },
      })
    }

    expect(selectPursuerDecision(poisoned)).toEqual(selectPursuerDecision(observation))
  })
})
