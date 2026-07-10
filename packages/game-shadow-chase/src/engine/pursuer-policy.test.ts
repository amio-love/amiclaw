import { describe, expect, it } from 'vitest'

import { getMap } from './maps'
import { nextStepOnShortestPath } from './pathfinding'
import {
  buildPursuerObservation,
  nextPursuerStep,
  pursuerNextStep,
  selectPursuerDecision,
  type PursuerObservation,
} from './pursuer-policy'
import { createRunningState } from './rules'

describe('pursuer observation policy', () => {
  it('ignores command and model intent while retaining an equally near visible target', () => {
    const state = createRunningState('crossroads', 'intense', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 2, y: 0 }
    state.actors.companion.position = { x: 6, y: 0 }
    state.actors.pursuer.target = 'player'
    state.command = { intent: 'decoy' }
    state.activeModelLease = {
      requestId: '00000000-0000-4000-8000-000000000001',
      acceptedTick: 0,
      expiryTick: 10,
      intent: 'decoy',
    }

    const baseline = structuredClone(state)
    baseline.command = { intent: 'follow' }
    baseline.activeModelLease = undefined

    expect(pursuerNextStep(state, 1)).toEqual({ x: 3, y: 0 })
    expect(pursuerNextStep(baseline, 1)).toEqual({ x: 3, y: 0 })
    expect(state.actors.pursuer.target).toBe('player')
    expect(state.actors.pursuer.destination).toBe('player')
    expect(baseline.actors.pursuer).toEqual(state.actors.pursuer)

    const companionTargeted = structuredClone(state)
    companionTargeted.actors.pursuer.target = 'companion'
    expect(pursuerNextStep(companionTargeted, 1)).toEqual({ x: 5, y: 0 })
    expect(companionTargeted.actors.pursuer.target).toBe('companion')
    expect(companionTargeted.actors.pursuer.destination).toBe('companion')
  })

  it('chooses the nearest visible shadow by path distance', () => {
    const state = createRunningState('crossroads', 'intense', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 0, y: 0 }
    state.actors.companion.position = { x: 6, y: 0 }
    state.actors.pursuer.target = 'player'

    expect(pursuerNextStep(state, 1)).toEqual({ x: 5, y: 0 })
    expect(state.actors.pursuer.target).toBe('companion')
    expect(state.actors.pursuer.destination).toBe('companion')
  })

  it('falls back to the player when tie memory is absent or ineligible', () => {
    const state = createRunningState('crossroads', 'intense', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 2, y: 0 }
    state.actors.companion.position = { x: 6, y: 0 }
    const observation = buildPursuerObservation(state)

    expect(
      selectPursuerDecision({
        ...observation,
        previousTarget: null,
      }).destination
    ).toBe('player')

    expect(
      selectPursuerDecision({
        ...observation,
        shadows: observation.shadows.map((shadow) =>
          shadow.id === 'companion' ? { ...shadow, status: 'captured' as const } : shadow
        ),
        previousTarget: 'companion',
      }).destination
    ).toBe('player')
  })

  it('searches toward the moon gate instead of a stale hidden target', () => {
    const state = createRunningState('crossroads', 'intense', 17)
    state.actors.pursuer.target = 'companion'
    const expected = nextStepOnShortestPath(
      getMap(state.mapId),
      state.actors.pursuer.position,
      state.exit.position
    )

    expect(pursuerNextStep(state, 1)).toEqual(expected)
    expect(state.actors.pursuer.destination).toBe('moon-gate')
    expect(state.actors.pursuer.target).toBe('companion')
  })

  it('excludes a captured shadow from visible pursuit candidates', () => {
    const state = createRunningState('crossroads', 'intense', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 0, y: 0 }
    state.actors.companion.position = { x: 5, y: 0 }
    state.actors.companion.status = 'captured'
    state.actors.pursuer.target = 'companion'

    expect(pursuerNextStep(state, 1)).toEqual({ x: 3, y: 0 })
    expect(state.actors.pursuer.destination).toBe('player')
    expect(state.actors.pursuer.target).toBe('player')
  })

  it('observes and selects every tick while cadence gates movement only', () => {
    const state = createRunningState('crossroads', 'relaxed', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 0, y: 0 }
    state.actors.companion.position = { x: 5, y: 0 }
    state.actors.pursuer.target = 'player'

    expect(pursuerNextStep(state, 1)).toEqual({ x: 4, y: 0 })
    expect(state.actors.pursuer.destination).toBe('companion')
    expect(state.actors.pursuer.target).toBe('companion')
  })

  it('drops a newly hidden destination off cadence while preserving tie memory', () => {
    const state = createRunningState('crossroads', 'relaxed', 17)
    state.actors.pursuer.position = { x: 4, y: 0 }
    state.actors.player.position = { x: 0, y: 1 }
    state.actors.companion.position = { x: 5, y: 0 }
    state.actors.pursuer.target = 'companion'
    pursuerNextStep(state, 1)
    state.actors.companion.position = { x: 5, y: 1 }

    expect(pursuerNextStep(state, 2)).toEqual({ x: 4, y: 0 })
    expect(state.actors.pursuer.destination).toBe('moon-gate')
    expect(state.actors.pursuer.target).toBe('companion')
  })

  it('stays at the moon gate when no free shadow is visible', () => {
    const state = createRunningState('crossroads', 'intense', 17)
    state.actors.pursuer.position = { ...state.exit.position }

    expect(pursuerNextStep(state, 1)).toEqual(state.exit.position)
    expect(state.actors.pursuer.destination).toBe('moon-gate')
  })

  it('makes the same observation and step across difficulties on a shared cadence tick', () => {
    const decisions = (['relaxed', 'standard', 'intense'] as const).map((difficulty) => {
      const state = createRunningState('crossroads', difficulty, 17)
      state.actors.pursuer.position = { x: 4, y: 0 }
      state.actors.player.position = { x: 0, y: 0 }
      state.actors.companion.position = { x: 5, y: 0 }
      const step = pursuerNextStep(state, 6)
      return {
        step,
        target: state.actors.pursuer.target,
        destination: state.actors.pursuer.destination,
      }
    })

    expect(decisions[1]).toEqual(decisions[0])
    expect(decisions[2]).toEqual(decisions[0])
  })

  it('builds a narrow observation without reading forbidden simulation fields', () => {
    const state = createRunningState('crossroads', 'standard', 17)
    for (const field of [
      'command',
      'activeModelLease',
      'difficulty',
      'objectives',
      'exit',
      'decisionEpoch',
      'eventLog',
      'playerNavigation',
      'rngState',
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
      'command',
      'modelLease',
      'difficulty',
      'objectives',
      'voice',
      'subtitle',
    ]) {
      Object.defineProperty(poisoned, field, {
        get: () => {
          throw new Error(`forbidden read: ${field}`)
        },
      })
    }

    const baseline = selectPursuerDecision(observation)
    const poisonedDecision = selectPursuerDecision(poisoned)
    expect(poisonedDecision).toEqual(baseline)
    expect(nextPursuerStep(poisoned, poisonedDecision)).toEqual(
      nextPursuerStep(observation, baseline)
    )
  })

  it('does not let hidden actor movement change the moon-gate route', () => {
    const first = createRunningState('crossroads', 'standard', 17)
    first.actors.pursuer.target = 'companion'
    const movedHidden = structuredClone(first)
    movedHidden.actors.companion.position = { x: 8, y: 0 }

    expect(selectPursuerDecision(buildPursuerObservation(movedHidden))).toEqual(
      selectPursuerDecision(buildPursuerObservation(first))
    )
  })
})
