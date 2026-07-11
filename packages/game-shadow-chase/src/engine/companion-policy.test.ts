import { describe, expect, it } from 'vitest'

import { companionNextStep } from './companion-policy'
import { getMap } from './maps'
import { pathDistance } from './pathfinding'
import { createRunningState } from './rules'

describe('deterministic companion positioning policy', () => {
  it('moves into the player trail in support mode', () => {
    const state = createRunningState('courtyard', 'standard', 23)
    state.command = { intent: 'support' }

    expect(companionNextStep(state)).toEqual(state.actors.player.position)
  })

  it('moves closer to an uncollected core in scout mode', () => {
    const state = createRunningState('courtyard', 'standard', 23)
    state.command = { intent: 'scout', targetObjectiveId: 'core-aurora' }
    const map = getMap(state.mapId)
    const target = state.objectives[0].position

    expect(pathDistance(map, companionNextStep(state), target)).toBeLessThan(
      pathDistance(map, state.actors.companion.position, target)
    )
  })

  it('moves off the player route when scouting beside a core', () => {
    const state = createRunningState('courtyard', 'standard', 23)
    state.actors.player.position = { x: 4, y: 0 }
    state.actors.companion.position = { x: 5, y: 0 }
    state.command = { intent: 'scout', targetObjectiveId: 'core-aurora' }

    expect(companionNextStep(state)).toEqual({ x: 6, y: 0 })
  })

  it('increases player separation in anchor mode', () => {
    const state = createRunningState('courtyard', 'standard', 23)
    state.actors.companion.position = { x: 2, y: 2 }
    state.command = { intent: 'anchor' }
    const map = getMap(state.mapId)

    expect(
      pathDistance(map, companionNextStep(state), state.actors.player.position)
    ).toBeGreaterThan(
      pathDistance(map, state.actors.companion.position, state.actors.player.position)
    )
  })

  it('waits or evades while the pursuer occupies the captured player', () => {
    const state = createRunningState('courtyard', 'standard', 23)
    state.actors.player.status = 'captured'
    state.actors.player.rescueDeadlineTick = 24
    state.actors.player.position = { x: 2, y: 1 }
    state.actors.pursuer.position = { x: 2, y: 1 }
    state.actors.companion.position = { x: 1, y: 1 }

    expect(companionNextStep(state)).not.toEqual(state.actors.player.position)
  })
})
