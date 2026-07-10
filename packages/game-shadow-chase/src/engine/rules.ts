import { DIFFICULTY_CONFIG } from './config'
import { getMap, validateMap } from './maps'
import type { Coordinate, Difficulty, Direction, SimulationState } from './types'

export interface WalkableMap {
  readonly width: number
  readonly height: number
  readonly walls: readonly Coordinate[]
}

export function coordinatesEqual(left: Coordinate, right: Coordinate): boolean {
  return left.x === right.x && left.y === right.y
}

export function isCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== 'object') return false
  const coordinate = value as Coordinate
  return Number.isSafeInteger(coordinate.x) && Number.isSafeInteger(coordinate.y)
}

export function isInsideMap(map: WalkableMap, position: Coordinate): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < map.width && position.y < map.height
}

export function isWalkable(map: WalkableMap, position: Coordinate): boolean {
  return isInsideMap(map, position) && !map.walls.some((wall) => coordinatesEqual(wall, position))
}

export function moved(position: Coordinate, direction: Direction): Coordinate {
  const offsets: Record<Direction, Coordinate> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }
  const offset = offsets[direction]
  return { x: position.x + offset.x, y: position.y + offset.y }
}

export function directionBetween(from: Coordinate, to: Coordinate): Direction | null {
  if (to.x === from.x + 1 && to.y === from.y) return 'right'
  if (to.x === from.x - 1 && to.y === from.y) return 'left'
  if (to.y === from.y + 1 && to.x === from.x) return 'down'
  if (to.y === from.y - 1 && to.x === from.x) return 'up'
  return null
}

export function runIdForSeed(seed: number): string {
  const normalized = Math.abs(Math.trunc(seed)) % 1_000_000_000_000
  return `00000000-0000-4000-8000-${String(normalized).padStart(12, '0')}`
}

export function createRunningState(
  mapId: string,
  difficulty: Difficulty,
  seed: number
): SimulationState {
  const map = getMap(mapId)
  const validation = validateMap(map)
  if (!validation.ok) throw new Error(`Invalid authored map: ${validation.reason}`)
  if (!(difficulty in DIFFICULTY_CONFIG)) throw new Error(`Unknown difficulty: ${difficulty}`)
  return {
    schemaVersion: 1,
    seed,
    rngState: seed >>> 0,
    runId: runIdForSeed(seed),
    tick: 0,
    phase: 'running',
    mapId,
    difficulty,
    actors: {
      player: { id: 'player', position: { ...map.playerSpawn }, status: 'free' },
      companion: { id: 'companion', position: { ...map.companionSpawn }, status: 'free' },
      pursuer: {
        id: 'pursuer',
        position: { ...map.pursuerSpawn },
        target: 'player',
        destination: 'moon-gate',
      },
    },
    objectives: map.objectives.map((objective) => ({
      ...objective,
      position: { ...objective.position },
      collected: false,
    })),
    exit: { position: { ...map.exit }, enabled: false },
    command: { intent: 'follow' },
    cooldowns: { swapReadyTick: 0 },
    decisionEpoch: 0,
    eventLog: [],
  }
}
