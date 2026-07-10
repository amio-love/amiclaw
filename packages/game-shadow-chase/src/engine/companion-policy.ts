import { getMap } from './maps'
import { visibleSightCells } from './line-of-sight'
import { neighbors, nextStepOnShortestPath, pathDistance } from './pathfinding'
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

function decoyStep(state: SimulationState): Coordinate {
  const map = getMap(state.mapId)
  const companion = state.actors.companion.position
  const pursuer = state.actors.pursuer.position
  const player = state.actors.player.position
  const playerDistance = pathDistance(map, pursuer, player)
  const candidates = visibleSightCells(map, pursuer)
    .filter(
      (candidate) =>
        (candidate.x !== player.x || candidate.y !== player.y) &&
        (candidate.x !== pursuer.x || candidate.y !== pursuer.y)
    )
    .map((candidate) => ({
      candidate,
      companionDistance: pathDistance(map, companion, candidate),
      pursuerDistance: pathDistance(map, pursuer, candidate),
    }))
    .filter((candidate) => Number.isFinite(candidate.companionDistance))
  candidates.sort((left, right) => {
    const leftNearer = left.pursuerDistance < playerDistance ? 0 : 1
    const rightNearer = right.pursuerDistance < playerDistance ? 0 : 1
    return (
      leftNearer - rightNearer ||
      left.companionDistance - right.companionDistance ||
      left.pursuerDistance - right.pursuerDistance ||
      left.candidate.y - right.candidate.y ||
      left.candidate.x - right.candidate.x
    )
  })
  const target = candidates[0]?.candidate
  return target ? (nextStepOnShortestPath(map, companion, target) ?? companion) : companion
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
    return decoyStep(state)
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
