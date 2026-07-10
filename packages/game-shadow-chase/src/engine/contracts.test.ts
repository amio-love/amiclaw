import { describe, expect, it } from 'vitest'

import {
  DIFFICULTY_CONFIG,
  OBJECTIVE_COUNT,
  MIN_RUN_TICKS,
  RUN_CAP_TICKS,
  TICK_MS,
  isCanonicalUuid,
  isStableId,
} from './config'
import { AUTHORED_MAPS, validateMap } from './maps'
import { nextStepOnShortestPath } from './pathfinding'
import { hasLineOfSight, sightLanes } from './line-of-sight'

describe('frozen engine contracts', () => {
  it('freezes the five-minute fixed-step contract', () => {
    expect(TICK_MS).toBe(250)
    expect(MIN_RUN_TICKS).toBe(480)
    expect(RUN_CAP_TICKS).toBe(1200)
    expect(OBJECTIVE_COUNT).toBe(3)
  })

  it('validates all authored maps and required reachability', () => {
    expect(AUTHORED_MAPS).toHaveLength(3)
    for (const map of AUTHORED_MAPS) {
      expect(validateMap(map)).toEqual({ ok: true })
      expect(map.objectives).toHaveLength(OBJECTIVE_COUNT)
      for (const objective of map.objectives) {
        expect(nextStepOnShortestPath(map, map.playerSpawn, objective.position)).not.toBeNull()
        expect(nextStepOnShortestPath(map, map.companionSpawn, objective.position)).not.toBeNull()
      }
    }
  })

  it('rejects invalid ids, bounds, overlaps, and unreachable objectives', () => {
    expect(isStableId('core-1')).toBe(true)
    expect(isStableId('Core 1')).toBe(false)
    expect(isCanonicalUuid('00000000-0000-4000-8000-000000000000')).toBe(true)
    expect(isCanonicalUuid('run-1')).toBe(false)

    const map = structuredClone(AUTHORED_MAPS[0])
    map.width = 16
    expect(validateMap(map)).toEqual({ ok: false, reason: 'map-bounds' })

    const overlap = structuredClone(AUTHORED_MAPS[0])
    overlap.objectives[0].position = overlap.exit
    expect(validateMap(overlap)).toEqual({ ok: false, reason: 'initial-overlap' })

    const unsafeSpawn = structuredClone(AUTHORED_MAPS[0])
    unsafeSpawn.pursuerSpawn = { x: 1, y: 2 }
    expect(validateMap(unsafeSpawn)).toEqual({ ok: false, reason: 'pursuer-spawn-distance' })
  })

  it('uses unlimited unobstructed cardinal sight and no difficulty vision range', () => {
    const map = AUTHORED_MAPS[0]
    expect(hasLineOfSight(map, { x: 3, y: 1 }, { x: 3, y: 5 })).toBe(false)
    expect(hasLineOfSight({ ...map, width: 15, walls: [] }, { x: 0, y: 0 }, { x: 14, y: 0 })).toBe(
      true
    )
    expect(hasLineOfSight(map, { x: 0, y: 0 }, { x: 6, y: 6 })).toBe(false)
    expect(
      hasLineOfSight({ ...map, width: 5, walls: [{ x: 4, y: 0 }] }, { x: 0, y: 0 }, { x: 3, y: 0 })
    ).toBe(true)
    for (const config of Object.values(DIFFICULTY_CONFIG)) {
      expect(Object.keys(config).sort()).toEqual(['pursuerCadence', 'rescueTicks'])
    }
  })

  it('returns four deterministic sight lanes clipped by walls and boundaries', () => {
    const lanes = sightLanes({ width: 4, height: 4, walls: [{ x: 2, y: 0 }] }, { x: 0, y: 0 })

    expect(lanes).toEqual([
      { id: 'up', end: { x: 0, y: 0 } },
      { id: 'left', end: { x: 0, y: 0 } },
      { id: 'right', end: { x: 1, y: 0 } },
      { id: 'down', end: { x: 0, y: 3 } },
    ])
  })
})
