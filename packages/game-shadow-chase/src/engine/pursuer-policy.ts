import { DIFFICULTY_CONFIG } from './config'
import { getMap } from './maps'
import { nextStepOnShortestPath } from './pathfinding'
import type { WalkableMap } from './rules'
import type { Coordinate, ShadowActor, SimulationState } from './types'

export type PursuerDestination = 'player' | 'companion'

export interface PursuerObservation {
  readonly map: WalkableMap
  readonly pursuer: Coordinate
  readonly player: {
    readonly position: Coordinate
    readonly status: ShadowActor['status']
  }
  readonly companion: {
    readonly position: Coordinate
    readonly status: ShadowActor['status']
  }
}

export interface PursuerDecision {
  readonly destination: PursuerDestination
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
  })
  OBSERVATION_MAPS.set(map, observationMap)
  return observationMap
}

export function buildPursuerObservation(state: SimulationState): PursuerObservation {
  const map = getMap(state.mapId)
  return Object.freeze({
    map: immutableObservationMap(map),
    pursuer: immutableCoordinate(state.actors.pursuer.position),
    player: Object.freeze({
      position: immutableCoordinate(state.actors.player.position),
      status: state.actors.player.status,
    }),
    companion: Object.freeze({
      position: immutableCoordinate(state.actors.companion.position),
      status: state.actors.companion.status,
    }),
  })
}

export function selectPursuerDecision(observation: PursuerObservation): PursuerDecision {
  return Object.freeze({
    destination: observation.player.status === 'free' ? 'player' : 'companion',
  })
}

export function nextPursuerStep(
  observation: PursuerObservation,
  decision: PursuerDecision
): Coordinate {
  const destinationPosition = observation[decision.destination].position
  return (
    nextStepOnShortestPath(observation.map, observation.pursuer, destinationPosition) ??
    observation.pursuer
  )
}

function applyPursuerDecision(state: SimulationState, decision: PursuerDecision): void {
  state.actors.pursuer.destination = decision.destination
  state.actors.pursuer.target = decision.destination
}

export function refreshPursuerDecision(state: SimulationState): PursuerDecision {
  const decision = selectPursuerDecision(buildPursuerObservation(state))
  applyPursuerDecision(state, decision)
  return decision
}

export function pursuerStepPath(state: SimulationState, nextTick: number): readonly Coordinate[] {
  const observation = buildPursuerObservation(state)
  const decision = selectPursuerDecision(observation)
  applyPursuerDecision(state, decision)
  const first = nextPursuerStep(observation, decision)
  const path = [first]
  const interval = DIFFICULTY_CONFIG[state.difficulty].pursuerBonusStepInterval
  if (nextTick % interval === 0) {
    const advancedObservation: PursuerObservation = Object.freeze({
      ...observation,
      pursuer: immutableCoordinate(first),
    })
    path.push(nextPursuerStep(advancedObservation, selectPursuerDecision(advancedObservation)))
  }
  return Object.freeze(path)
}

export function pursuerNextStep(state: SimulationState, nextTick: number): Coordinate {
  const path = pursuerStepPath(state, nextTick)
  return path[path.length - 1]
}
