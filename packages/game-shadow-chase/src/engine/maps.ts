import {
  MAP_MAX_SIZE,
  MAP_MIN_SIZE,
  MIN_PURSUER_SPAWN_DISTANCE,
  OBJECTIVE_COUNT,
  isStableId,
} from './config'
import type { Coordinate, MapDefinition } from './types'

export const AUTHORED_MAPS: MapDefinition[] = [
  {
    id: 'courtyard',
    name: '星辉庭院',
    width: 7,
    height: 7,
    walls: [
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 3, y: 4 },
      { x: 1, y: 4 },
      { x: 5, y: 2 },
    ],
    playerSpawn: { x: 1, y: 1 },
    companionSpawn: { x: 2, y: 1 },
    pursuerSpawn: { x: 5, y: 5 },
    exit: { x: 0, y: 6 },
    objectives: [
      { id: 'core-aurora', position: { x: 6, y: 0 } },
      { id: 'core-ember', position: { x: 0, y: 5 } },
      { id: 'core-orbit', position: { x: 6, y: 6 } },
    ],
  },
  {
    id: 'crossroads',
    name: '月下十字路',
    width: 9,
    height: 9,
    walls: [
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 4, y: 3 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 4, y: 7 },
      { x: 2, y: 4 },
      { x: 6, y: 4 },
    ],
    playerSpawn: { x: 1, y: 1 },
    companionSpawn: { x: 1, y: 2 },
    pursuerSpawn: { x: 7, y: 7 },
    exit: { x: 4, y: 8 },
    objectives: [
      { id: 'core-dawn', position: { x: 7, y: 1 } },
      { id: 'core-dusk', position: { x: 1, y: 7 } },
      { id: 'core-moon', position: { x: 7, y: 4 } },
    ],
  },
  {
    id: 'moon-vault',
    name: '月影秘库',
    width: 11,
    height: 9,
    walls: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      { x: 8, y: 4 },
      { x: 8, y: 5 },
      { x: 8, y: 6 },
    ],
    playerSpawn: { x: 1, y: 1 },
    companionSpawn: { x: 1, y: 2 },
    pursuerSpawn: { x: 9, y: 7 },
    exit: { x: 10, y: 0 },
    objectives: [
      { id: 'core-flare', position: { x: 9, y: 1 } },
      { id: 'core-tide', position: { x: 4, y: 7 } },
      { id: 'core-veil', position: { x: 7, y: 4 } },
    ],
  },
]

export function getMap(mapId: string): MapDefinition {
  const map = AUTHORED_MAPS.find((candidate) => candidate.id === mapId)
  if (!map) throw new Error(`Unknown Shadow Chase map: ${mapId}`)
  return map
}

export type MapValidation = { ok: true } | { ok: false; reason: string }

function coordinateKey(position: Coordinate): string {
  return `${position.x}:${position.y}`
}

function isCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== 'object') return false
  const coordinate = value as Coordinate
  return Number.isSafeInteger(coordinate.x) && Number.isSafeInteger(coordinate.y)
}

function isWalkable(map: MapDefinition, position: Coordinate): boolean {
  return (
    position.x >= 0 &&
    position.y >= 0 &&
    position.x < map.width &&
    position.y < map.height &&
    !map.walls.some((wall) => wall.x === position.x && wall.y === position.y)
  )
}

function shortestDistance(
  map: MapDefinition,
  start: Coordinate,
  target: Coordinate
): number | null {
  const queue = [start]
  const visited = new Set([coordinateKey(start)])
  const distances = new Map([[coordinateKey(start), 0]])
  while (queue.length > 0) {
    const current = queue.shift()!
    const distance = distances.get(coordinateKey(current)) ?? 0
    if (current.x === target.x && current.y === target.y) return distance
    for (const candidate of [
      { x: current.x, y: current.y - 1 },
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y + 1 },
    ]) {
      const key = coordinateKey(candidate)
      if (!visited.has(key) && isWalkable(map, candidate)) {
        visited.add(key)
        distances.set(key, distance + 1)
        queue.push(candidate)
      }
    }
  }
  return null
}

function isReachable(map: MapDefinition, start: Coordinate, target: Coordinate): boolean {
  return shortestDistance(map, start, target) !== null
}

export function validateMap(map: MapDefinition): MapValidation {
  if (!map || !Number.isSafeInteger(map.width) || !Number.isSafeInteger(map.height)) {
    return { ok: false, reason: 'map-bounds' }
  }
  if (
    map.width < MAP_MIN_SIZE ||
    map.width > MAP_MAX_SIZE ||
    map.height < MAP_MIN_SIZE ||
    map.height > MAP_MAX_SIZE
  ) {
    return { ok: false, reason: 'map-bounds' }
  }
  if (!isStableId(map.id) || map.objectives.length !== OBJECTIVE_COUNT) {
    return { ok: false, reason: 'cardinality-or-id' }
  }
  const positions: Coordinate[] = [
    map.playerSpawn,
    map.companionSpawn,
    map.pursuerSpawn,
    map.exit,
    ...map.objectives.map((objective) => objective.position),
  ]
  if (
    positions.some((position) => !isCoordinate(position) || !isWalkable(map, position)) ||
    new Set(positions.map((position) => `${position.x}:${position.y}`)).size !== positions.length
  ) {
    return { ok: false, reason: 'initial-overlap' }
  }
  const objectiveIds = map.objectives.map((objective) => objective.id)
  if (
    objectiveIds.some((id) => !isStableId(id)) ||
    new Set(objectiveIds).size !== objectiveIds.length
  ) {
    return { ok: false, reason: 'objective-id' }
  }
  for (const origin of [map.playerSpawn, map.companionSpawn]) {
    for (const target of [...map.objectives.map((objective) => objective.position), map.exit]) {
      if (!isReachable(map, origin, target)) {
        return { ok: false, reason: 'unreachable' }
      }
    }
  }
  if (!isReachable(map, map.pursuerSpawn, map.playerSpawn)) {
    return { ok: false, reason: 'pursuer-unreachable' }
  }
  if (
    [map.playerSpawn, map.companionSpawn].some(
      (spawn) => (shortestDistance(map, map.pursuerSpawn, spawn) ?? 0) < MIN_PURSUER_SPAWN_DISTANCE
    )
  ) {
    return { ok: false, reason: 'pursuer-spawn-distance' }
  }
  return { ok: true }
}
