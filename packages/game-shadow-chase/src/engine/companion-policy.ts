import { DIFFICULTY_CONFIG } from './config'
import { getMap } from './maps'
import {
  coordinateKey,
  neighbors,
  nextStepOnShortestPath,
  pathDistance,
  shortestPath,
} from './pathfinding'
import { coordinatesEqual, isWalkable, type WalkableMap } from './rules'
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

function objectiveApproach(state: SimulationState, objective: Coordinate): Coordinate {
  const map = getMap(state.mapId)
  const companion = state.actors.companion.position
  const candidates = neighbors(map, objective)
  const playerRoute = shortestPath(map, state.actors.player.position, objective) ?? []
  const playerRouteKeys = new Set(playerRoute.map(coordinateKey))
  const offRoute = candidates.filter((candidate) => !playerRouteKeys.has(coordinateKey(candidate)))
  const available = offRoute.length > 0 ? offRoute : candidates
  available.sort((left, right) => {
    const travelDistance = pathDistance(map, companion, left) - pathDistance(map, companion, right)
    const pursuerDistance =
      pathDistance(map, right, state.actors.pursuer.position) -
      pathDistance(map, left, state.actors.pursuer.position)
    return travelDistance || pursuerDistance || left.y - right.y || left.x - right.x
  })
  return available[0] ?? companion
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

function mapAvoiding(map: WalkableMap, blocked: readonly Coordinate[]): WalkableMap {
  return {
    width: map.width,
    height: map.height,
    walls: [...map.walls, ...blocked],
  }
}

function rescueStep(state: SimulationState): Coordinate {
  const map = getMap(state.mapId)
  const companion = state.actors.companion.position
  const player = state.actors.player.position
  const pursuer = state.actors.pursuer.position
  const pursuerFirst = nextStepOnShortestPath(map, pursuer, companion) ?? pursuer
  const pursuerPath = [pursuer, pursuerFirst]
  const bonusInterval = DIFFICULTY_CONFIG[state.difficulty].pursuerBonusStepInterval
  if ((state.tick + 1) % bonusInterval === 0) {
    pursuerPath.push(nextStepOnShortestPath(map, pursuerFirst, companion) ?? pursuerFirst)
  }
  if (pursuerPath.some((position) => coordinatesEqual(player, position))) {
    return evade(state) ?? companion
  }
  const safeMap = mapAvoiding(map, pursuerPath)
  return nextStepOnShortestPath(safeMap, companion, player) ?? evade(state) ?? companion
}

function farAnchor(state: SimulationState): Coordinate {
  const map = getMap(state.mapId)
  const companion = state.actors.companion.position
  const candidates: Coordinate[] = []
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const candidate = { x, y }
      if (isWalkable(map, candidate)) candidates.push(candidate)
    }
  }
  candidates.sort((left, right) => {
    const playerDistance =
      pathDistance(map, right, state.actors.player.position) -
      pathDistance(map, left, state.actors.player.position)
    const pursuerDistance =
      pathDistance(map, right, state.actors.pursuer.position) -
      pathDistance(map, left, state.actors.pursuer.position)
    const travelDistance = pathDistance(map, companion, left) - pathDistance(map, companion, right)
    return (
      playerDistance || pursuerDistance || travelDistance || left.y - right.y || left.x - right.x
    )
  })
  return candidates[0] ?? companion
}

export function companionNextStep(state: SimulationState): Coordinate {
  const actor = state.actors.companion
  if (actor.status === 'captured' || state.phase !== 'running') return actor.position
  const map = getMap(state.mapId)
  if (state.actors.player.status === 'captured') return rescueStep(state)
  const evasive = evade(state)
  if (evasive) return evasive
  if (state.exit.enabled) {
    return nextStepOnShortestPath(map, actor.position, state.exit.position) ?? actor.position
  }
  const lease = state.activeModelLease
  const leasedIntent = lease && lease.expiryTick >= state.tick + 1 ? lease : undefined
  const intent =
    state.command.intent !== 'support' ? state.command : (leasedIntent ?? state.command)
  if (intent.intent === 'scout') {
    const objective = state.objectives.find(
      (candidate) => candidate.id === intent.targetObjectiveId && !candidate.collected
    )
    const objectivePosition = objective?.position ?? nearestObjective(state)
    const target = objectivePosition ? objectiveApproach(state, objectivePosition) : null
    return target
      ? (nextStepOnShortestPath(map, actor.position, target) ?? actor.position)
      : actor.position
  }
  if (intent.intent === 'anchor') {
    return nextStepOnShortestPath(map, actor.position, farAnchor(state)) ?? actor.position
  }
  return nextStepOnShortestPath(map, actor.position, state.actors.player.position) ?? actor.position
}
