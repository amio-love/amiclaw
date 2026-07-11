export const TICK_MS = 250
export const RUN_CAP_TICKS = 1200
export const OBJECTIVE_COUNT = 3
export const MAP_MIN_SIZE = 7
export const MAP_MAX_SIZE = 15
export const MIN_PURSUER_SPAWN_DISTANCE = 6
export const STABLE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
export const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isStableId(value: unknown): value is string {
  return typeof value === 'string' && STABLE_ID_PATTERN.test(value)
}

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_PATTERN.test(value)
}

export function isSafeTick(value: unknown, max = RUN_CAP_TICKS): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max
}

export const DIFFICULTY_CONFIG = Object.freeze({
  relaxed: Object.freeze({ pursuerBonusStepInterval: 8, rescueTicks: 32 }),
  standard: Object.freeze({ pursuerBonusStepInterval: 6, rescueTicks: 24 }),
  intense: Object.freeze({ pursuerBonusStepInterval: 4, rescueTicks: 20 }),
})
