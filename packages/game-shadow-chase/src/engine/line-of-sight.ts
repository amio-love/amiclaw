import type { WalkableMap } from './rules'
import type { Coordinate } from './types'

const CARDINAL_DIRECTIONS = [
  { id: 'up', x: 0, y: -1 },
  { id: 'left', x: -1, y: 0 },
  { id: 'right', x: 1, y: 0 },
  { id: 'down', x: 0, y: 1 },
] as const

function inside(map: WalkableMap, position: Coordinate): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < map.width && position.y < map.height
}

function isWall(map: WalkableMap, position: Coordinate): boolean {
  return map.walls.some((wall) => wall.x === position.x && wall.y === position.y)
}

export function hasLineOfSight(map: WalkableMap, from: Coordinate, to: Coordinate): boolean {
  if (from.x !== to.x && from.y !== to.y) return false
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  for (let x = from.x + dx, y = from.y + dy; x !== to.x || y !== to.y; x += dx, y += dy) {
    if (isWall(map, { x, y })) return false
  }
  return true
}

export interface SightLane {
  id: (typeof CARDINAL_DIRECTIONS)[number]['id']
  end: Coordinate
}

export function sightLanes(map: WalkableMap, origin: Coordinate): SightLane[] {
  return CARDINAL_DIRECTIONS.map((direction) => {
    let cursor = { x: origin.x + direction.x, y: origin.y + direction.y }
    let end: Coordinate | null = null
    while (inside(map, cursor) && !isWall(map, cursor)) {
      end = cursor
      cursor = { x: cursor.x + direction.x, y: cursor.y + direction.y }
    }
    return { id: direction.id, end: end ?? origin }
  })
}

export function visibleSightCells(map: WalkableMap, origin: Coordinate): Coordinate[] {
  return CARDINAL_DIRECTIONS.flatMap((direction) => {
    const cells: Coordinate[] = []
    let cursor = { x: origin.x + direction.x, y: origin.y + direction.y }
    while (inside(map, cursor) && !isWall(map, cursor)) {
      cells.push(cursor)
      cursor = { x: cursor.x + direction.x, y: cursor.y + direction.y }
    }
    return cells
  })
}
