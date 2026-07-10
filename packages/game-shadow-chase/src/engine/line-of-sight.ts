import type { Coordinate, MapDefinition } from './types'

export function hasLineOfSight(
  map: MapDefinition,
  from: Coordinate,
  to: Coordinate,
  maxRange: number
): boolean {
  const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
  if (distance > maxRange || (from.x !== to.x && from.y !== to.y)) return false
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  for (let x = from.x + dx, y = from.y + dy; x !== to.x || y !== to.y; x += dx, y += dy) {
    if (map.walls.some((wall) => wall.x === x && wall.y === y)) return false
  }
  return true
}
