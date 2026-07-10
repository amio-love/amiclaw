import { DIFFICULTY_CONFIG } from './config'
import { hasLineOfSight } from './line-of-sight'
import { getMap } from './maps'
import { nextStepOnShortestPath, pathDistance } from './pathfinding'
import type { Coordinate, SimulationState } from './types'

export function pursuerNextStep(state: SimulationState, nextTick: number): Coordinate {
  const pursuer = state.actors.pursuer
  const config = DIFFICULTY_CONFIG[state.difficulty]
  if (nextTick % config.pursuerCadence !== 0) return pursuer.position
  const map = getMap(state.mapId)
  const commandIntent = state.command.intent
  const leaseIntent =
    state.activeModelLease && state.activeModelLease.expiryTick >= nextTick
      ? state.activeModelLease.intent
      : undefined
  let target: 'player' | 'companion'
  if (commandIntent === 'decoy' || leaseIntent === 'decoy') {
    target = 'companion'
  } else {
    const visible = (['player', 'companion'] as const).filter((actorId) =>
      hasLineOfSight(map, pursuer.position, state.actors[actorId].position, config.visionRange)
    )
    if (visible.length === 0) {
      target = pursuer.target
    } else {
      visible.sort((left, right) => {
        const distance =
          pathDistance(map, pursuer.position, state.actors[left].position) -
          pathDistance(map, pursuer.position, state.actors[right].position)
        return distance || (left === 'player' ? -1 : 1)
      })
      target = visible[0]
    }
  }
  state.actors.pursuer.target = target
  return (
    nextStepOnShortestPath(map, pursuer.position, state.actors[target].position) ?? pursuer.position
  )
}
