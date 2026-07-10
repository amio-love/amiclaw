import { getMap } from './maps'
import { neighbors, nextStepOnShortestPath, pathDistance } from './pathfinding'
import { coordinatesEqual } from './rules'
import type { Coordinate, SimulationState } from './types'

function nearestObjective(state: SimulationState): Coordinate | null {
  const map = getMap(state.mapId)
  const available = state.objectives.filter((objective) => !objective.collected)
  available.sort((left, right) => {
    const distance =
      pathDistance(map, state.actors.companion.position, left.position) -
      pathDistance(map, state.actors.companion.position, right.position)
    return distance || left.id.localeCompare(right.id)
  })
  return available[0]?.position ?? null
}

function evade(state: SimulationState): Coordinate | null {
  const map = getMap(state.mapId)
  const companion = state.actors.companion.position
  const pursuer = state.actors.pursuer.position
  if (Math.abs(companion.x - pursuer.x) + Math.abs(companion.y - pursuer.y) > 2) return null
  const options = neighbors(map, companion)
  options.sort((left, right) => {
    const distanceDelta = pathDistance(map, right, pursuer) - pathDistance(map, left, pursuer)
    return distanceDelta || left.y - right.y || left.x - right.x
  })
  return options[0] ?? null
}

export function companionNextStep(state: SimulationState): Coordinate {
  const actor = state.actors.companion
  if (actor.status === 'captured' || state.phase !== 'running') return actor.position
  const map = getMap(state.mapId)
  if (state.actors.player.status === 'captured') {
    return (
      nextStepOnShortestPath(map, actor.position, state.actors.player.position) ?? actor.position
    )
  }
  const evasive = evade(state)
  if (evasive) return evasive
  if (state.exit.enabled) {
    return nextStepOnShortestPath(map, actor.position, state.exit.position) ?? actor.position
  }
  const lease = state.activeModelLease
  const leasedIntent = lease && lease.expiryTick >= state.tick + 1 ? lease : undefined
  const intent = state.command.intent !== 'follow' ? state.command : (leasedIntent ?? state.command)
  if (intent.intent === 'split') {
    const objective = state.objectives.find(
      (candidate) => candidate.id === intent.targetObjectiveId && !candidate.collected
    )
    const target = objective?.position ?? nearestObjective(state)
    return target
      ? (nextStepOnShortestPath(map, actor.position, target) ?? actor.position)
      : actor.position
  }
  if (intent.intent === 'decoy') {
    const options = neighbors(map, actor.position).filter(
      (candidate) => !coordinatesEqual(candidate, state.actors.player.position)
    )
    options.sort((left, right) => {
      const fromPlayer =
        pathDistance(map, right, state.actors.player.position) -
        pathDistance(map, left, state.actors.player.position)
      const toPursuer =
        pathDistance(map, left, state.actors.pursuer.position) -
        pathDistance(map, right, state.actors.pursuer.position)
      return fromPlayer || toPursuer || left.y - right.y || left.x - right.x
    })
    return options[0] ?? actor.position
  }
  const uncollected = nearestObjective(state)
  if (
    uncollected &&
    pathDistance(map, actor.position, uncollected) + 2 <
      pathDistance(map, actor.position, state.actors.player.position)
  ) {
    return nextStepOnShortestPath(map, actor.position, uncollected) ?? actor.position
  }
  return nextStepOnShortestPath(map, actor.position, state.actors.player.position) ?? actor.position
}
