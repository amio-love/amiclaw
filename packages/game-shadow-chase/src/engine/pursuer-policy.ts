import { DIFFICULTY_CONFIG } from './config'
import { hasLineOfSight } from './line-of-sight'
import { getMap } from './maps'
import { nextStepOnShortestPath } from './pathfinding'
import type { WalkableMap } from './rules'
import type { Coordinate, ShadowActor, SimulationState } from './types'

export type PursuerShadowId = ShadowActor['id']
export type PursuerDestination = PursuerShadowId | 'moon-gate'

export interface PursuerObservation {
  readonly map: WalkableMap & { readonly moonGate: Coordinate }
  readonly pursuer: Coordinate
  readonly shadows: readonly {
    readonly id: PursuerShadowId
    readonly position: Coordinate
    readonly status: ShadowActor['status']
  }[]
  readonly previousTarget: PursuerShadowId | null
}

export interface PursuerDecision {
  readonly visibleCandidates: readonly PursuerShadowId[]
  readonly destination: PursuerDestination
  readonly targetMemory: PursuerShadowId | null
}

function immutableCoordinate(position: Coordinate): Coordinate {
  return Object.freeze({ x: position.x, y: position.y })
}

const OBSERVATION_MAPS = new WeakMap<object, PursuerObservation['map']>()

function immutableObservationMap(map: ReturnType<typeof getMap>): PursuerObservation['map'] {
  const cached = OBSERVATION_MAPS.get(map)
  if (cached) return cached
  const observationMap = Object.freeze({
    width: map.width,
    height: map.height,
    walls: Object.freeze(map.walls.map(immutableCoordinate)),
    moonGate: immutableCoordinate(map.exit),
  })
  OBSERVATION_MAPS.set(map, observationMap)
  return observationMap
}

export function buildPursuerObservation(state: SimulationState): PursuerObservation {
  const map = getMap(state.mapId)
  return Object.freeze({
    map: immutableObservationMap(map),
    pursuer: immutableCoordinate(state.actors.pursuer.position),
    shadows: Object.freeze(
      (['player', 'companion'] as const).map((id) =>
        Object.freeze({
          id,
          position: immutableCoordinate(state.actors[id].position),
          status: state.actors[id].status,
        })
      )
    ),
    previousTarget: state.actors.pursuer.target,
  })
}

export function selectPursuerDecision(observation: PursuerObservation): PursuerDecision {
  const visibleCandidates = observation.shadows.filter(
    (actor) =>
      actor.status === 'free' &&
      hasLineOfSight(observation.map, observation.pursuer, actor.position)
  )
  let destination: PursuerDestination = 'moon-gate'
  let targetMemory = observation.previousTarget
  if (visibleCandidates.length > 0) {
    const distances = visibleCandidates.map((actor) => ({
      actor,
      // A visible actor shares an unobstructed row or column with the pursuer,
      // so this direct segment is also the map's shortest walkable path.
      distance:
        Math.abs(observation.pursuer.x - actor.position.x) +
        Math.abs(observation.pursuer.y - actor.position.y),
    }))
    const nearestDistance = Math.min(...distances.map((candidate) => candidate.distance))
    const nearest = distances
      .filter((candidate) => candidate.distance === nearestDistance)
      .map((candidate) => candidate.actor.id)
    destination =
      targetMemory !== null && nearest.includes(targetMemory) ? targetMemory : nearest[0]
    targetMemory = destination
  }
  return Object.freeze({
    visibleCandidates: Object.freeze(visibleCandidates.map((actor) => actor.id)),
    destination,
    targetMemory,
  })
}

export function nextPursuerStep(
  observation: PursuerObservation,
  decision: PursuerDecision
): Coordinate {
  const destinationPosition =
    decision.destination === 'moon-gate'
      ? observation.map.moonGate
      : observation.shadows.find((actor) => actor.id === decision.destination)!.position
  return (
    nextStepOnShortestPath(observation.map, observation.pursuer, destinationPosition) ??
    observation.pursuer
  )
}

function applyPursuerDecision(state: SimulationState, decision: PursuerDecision): void {
  state.actors.pursuer.destination = decision.destination
  if (decision.targetMemory !== null) state.actors.pursuer.target = decision.targetMemory
}

export function refreshPursuerDecision(state: SimulationState): PursuerDecision {
  const decision = selectPursuerDecision(buildPursuerObservation(state))
  applyPursuerDecision(state, decision)
  return decision
}

export function pursuerNextStep(state: SimulationState, nextTick: number): Coordinate {
  const observation = buildPursuerObservation(state)
  const decision = selectPursuerDecision(observation)
  applyPursuerDecision(state, decision)
  return nextTick % DIFFICULTY_CONFIG[state.difficulty].pursuerCadence === 0
    ? nextPursuerStep(observation, decision)
    : state.actors.pursuer.position
}
