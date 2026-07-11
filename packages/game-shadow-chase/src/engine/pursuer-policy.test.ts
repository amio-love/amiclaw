import { describe, expect, it } from 'vitest'

import {
  buildPursuerObservation,
  nextPursuerStep,
  pursuerStepPath,
  selectPursuerDecision,
  type PursuerObservation,
} from './pursuer-policy'
import { createRunningState } from './rules'

describe('priority pursuer policy', () => {
  it('targets the player even through walls and with a nearer companion', () => {
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

    expect(decision).toEqual({ destination: 'player' })
    expect(nextPursuerStep(buildPursuerObservation(state), decision)).toEqual({ x: 3, y: 0 })
  })

  it('keeps pursuing the player without a visibility state', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 4, y: 4 }

    expect(selectPursuerDecision(buildPursuerObservation(state)).destination).toBe('player')
  })

  it('targets the companion only after the player is captured', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 2, y: 0 }
    state.actors.player.status = 'captured'

    expect(selectPursuerDecision(buildPursuerObservation(state)).destination).toBe('companion')
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
    for (const field of ['command', 'modelLease', 'difficulty', 'objectives', 'voice']) {
      Object.defineProperty(poisoned, field, {
        get: () => {
          throw new Error(`forbidden read: ${field}`)
        },
      })
    }

    expect(selectPursuerDecision(poisoned)).toEqual(selectPursuerDecision(observation))
  })
})
