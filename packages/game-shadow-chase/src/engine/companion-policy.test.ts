import { describe, expect, it } from 'vitest'

import { companionNextStep } from './companion-policy'
import { hasLineOfSight, visibleSightCells } from './line-of-sight'
import { getMap } from './maps'
import { pathDistance } from './pathfinding'
import { createRunningState } from './rules'
import { buildPursuerObservation, selectPursuerDecision } from './pursuer-policy'

describe('deterministic companion decoy policy', () => {
  it('moves toward a sight-lane cell that would become nearer than the player', () => {
    const state = createRunningState('courtyard', 'standard', 23)
    state.actors.pursuer.position = { x: 6, y: 6 }
    state.actors.player.position = { x: 6, y: 0 }
    state.actors.companion.position = { x: 0, y: 0 }
    state.actors.pursuer.target = 'player'
    state.command = { intent: 'decoy' }
    const map = getMap(state.mapId)
    const playerDistance = pathDistance(
      map,
      state.actors.pursuer.position,
      state.actors.player.position
    )
    const nearerSightCells = visibleSightCells(map, state.actors.pursuer.position).filter(
      (candidate) =>
        pathDistance(map, state.actors.pursuer.position, candidate) < playerDistance &&
        (candidate.x !== state.actors.player.position.x ||
          candidate.y !== state.actors.player.position.y)
    )
    const distanceToLane = (position: { x: number; y: number }) =>
      Math.min(...nearerSightCells.map((candidate) => pathDistance(map, position, candidate)))

    const next = companionNextStep(state)

    expect(distanceToLane(next)).toBeLessThan(distanceToLane(state.actors.companion.position))
    expect(state.actors.pursuer.target).toBe('player')
  })

  it('switches pursuit only after decoy movement creates visible nearer geometry', () => {
    const state = createRunningState('courtyard', 'standard', 23)
    state.actors.pursuer.position = { x: 6, y: 6 }
    state.actors.player.position = { x: 6, y: 0 }
    state.actors.companion.position = { x: 0, y: 0 }
    state.command = { intent: 'decoy' }
    const map = getMap(state.mapId)
    let switched = false
    let switchTick = -1

    for (let step = 0; step < 20; step += 1) {
      const decision = selectPursuerDecision(buildPursuerObservation(state))
      const visible = hasLineOfSight(
        map,
        state.actors.pursuer.position,
        state.actors.companion.position
      )
      const strictlyNearer =
        pathDistance(map, state.actors.pursuer.position, state.actors.companion.position) <
        pathDistance(map, state.actors.pursuer.position, state.actors.player.position)
      if (decision.destination === 'companion') {
        expect(visible).toBe(true)
        expect(strictlyNearer).toBe(true)
        switched = true
        switchTick = step
        break
      }
      expect(visible && strictlyNearer).toBe(false)
      expect(decision.destination).toBe('player')
      state.actors.companion.position = companionNextStep(state)
    }

    expect(switched).toBe(true)
    expect(switchTick).toBeGreaterThan(0)
  })
})
