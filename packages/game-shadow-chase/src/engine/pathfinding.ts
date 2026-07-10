import { coordinatesEqual, isWalkable } from './rules'
import type { Coordinate, MapDefinition } from './types'

const OFFSETS: Coordinate[] = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
]

export function coordinateKey(value: Coordinate): string {
  return `${value.x}:${value.y}`
}

export function neighbors(map: MapDefinition, position: Coordinate): Coordinate[] {
  return OFFSETS.map((offset) => ({ x: position.x + offset.x, y: position.y + offset.y })).filter(
    (candidate) => isWalkable(map, candidate)
  )
}

export function shortestPath(
  map: MapDefinition,
  start: Coordinate,
  target: Coordinate
): Coordinate[] | null {
  if (!isWalkable(map, start) || !isWalkable(map, target)) return null
  if (coordinatesEqual(start, target)) return [start]
  const queue: Coordinate[] = [start]
  const previous = new Map<string, Coordinate | null>([[coordinateKey(start), null]])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const candidate of neighbors(map, current)) {
      const key = coordinateKey(candidate)
      if (previous.has(key)) continue
      previous.set(key, current)
      if (coordinatesEqual(candidate, target)) {
        const path = [candidate]
        let cursor: Coordinate | null = current
        while (cursor) {
          path.unshift(cursor)
          cursor = previous.get(coordinateKey(cursor)) ?? null
        }
        return path
      }
      queue.push(candidate)
    }
  }
  return null
}

export function nextStepOnShortestPath(
  map: MapDefinition,
  start: Coordinate,
  target: Coordinate
): Coordinate | null {
  const path = shortestPath(map, start, target)
  return path && path.length > 1 ? path[1] : (path?.[0] ?? null)
}

export function pathDistance(map: MapDefinition, start: Coordinate, target: Coordinate): number {
  const path = shortestPath(map, start, target)
  return path ? path.length - 1 : Number.POSITIVE_INFINITY
}
