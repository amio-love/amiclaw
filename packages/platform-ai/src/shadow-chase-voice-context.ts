/** Strict public context accepted from the Shadow Chase voice client. */

export const MAX_SHADOW_CHASE_VOICE_CONTEXT_BYTES = 8_192
export const MAX_SHADOW_CHASE_VOICE_WALLS = 64
export const MAX_SHADOW_CHASE_VOICE_OBJECTIVES = 3
export const MAX_SHADOW_CHASE_VOICE_ID_CODEPOINTS = 32

type Strategy = 'follow' | 'split' | 'decoy'
type Coordinate = { x: number; y: number }

export interface ShadowChaseVoiceContext {
  version: 1
  phase: 'planning' | 'running'
  strategy: Strategy
  allowedStrategies: ['follow', 'split', 'decoy']
  map: { id: string; width: number; height: number; walls: Coordinate[] }
  objectives: Array<{ id: string; position: Coordinate }>
  collectedObjectiveIds: string[]
  exit: Coordinate
  actors: Array<{ id: 'player' | 'companion'; status: 'free' | 'captured' }>
}

export type ShadowChaseVoiceContextValidation =
  | { ok: true; value: ShadowChaseVoiceContext }
  | { ok: false; reason: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}

function stableId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    [...value].length > 0 &&
    [...value].length <= MAX_SHADOW_CHASE_VOICE_ID_CODEPOINTS &&
    /^[a-z][a-z0-9-]*$/.test(value)
  )
}

function coordinate(value: unknown, width: number, height: number): value is Coordinate {
  return (
    record(value) &&
    exactKeys(value, ['x', 'y']) &&
    Number.isSafeInteger(value.x) &&
    Number.isSafeInteger(value.y) &&
    Number(value.x) >= 0 &&
    Number(value.y) >= 0 &&
    Number(value.x) < width &&
    Number(value.y) < height
  )
}

function serializedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function validateShadowChaseVoiceContext(value: unknown): ShadowChaseVoiceContextValidation {
  if (serializedBytes(value) > MAX_SHADOW_CHASE_VOICE_CONTEXT_BYTES) {
    return { ok: false, reason: 'size' }
  }
  if (
    !record(value) ||
    !exactKeys(value, [
      'version',
      'phase',
      'strategy',
      'allowedStrategies',
      'map',
      'objectives',
      'collectedObjectiveIds',
      'exit',
      'actors',
    ])
  ) {
    return { ok: false, reason: 'keys' }
  }
  if (value.version !== 1 || (value.phase !== 'planning' && value.phase !== 'running')) {
    return { ok: false, reason: 'version-phase' }
  }
  if (!['follow', 'split', 'decoy'].includes(String(value.strategy))) {
    return { ok: false, reason: 'strategy' }
  }
  if (
    !Array.isArray(value.allowedStrategies) ||
    value.allowedStrategies.length !== 3 ||
    value.allowedStrategies.join(',') !== 'follow,split,decoy'
  ) {
    return { ok: false, reason: 'allowed-strategies' }
  }
  if (!record(value.map) || !exactKeys(value.map, ['id', 'width', 'height', 'walls'])) {
    return { ok: false, reason: 'map' }
  }
  const width = Number(value.map.width)
  const height = Number(value.map.height)
  if (
    !stableId(value.map.id) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    width > 15 ||
    height < 1 ||
    height > 15 ||
    !Array.isArray(value.map.walls) ||
    value.map.walls.length > MAX_SHADOW_CHASE_VOICE_WALLS ||
    !value.map.walls.every((item) => coordinate(item, width, height))
  ) {
    return { ok: false, reason: 'map' }
  }
  if (
    !Array.isArray(value.objectives) ||
    value.objectives.length < 1 ||
    value.objectives.length > MAX_SHADOW_CHASE_VOICE_OBJECTIVES
  ) {
    return { ok: false, reason: 'objectives' }
  }
  const objectiveIds: string[] = []
  for (const item of value.objectives) {
    if (
      !record(item) ||
      !exactKeys(item, ['id', 'position']) ||
      !stableId(item.id) ||
      !coordinate(item.position, width, height)
    ) {
      return { ok: false, reason: 'objective' }
    }
    objectiveIds.push(item.id)
  }
  if (new Set(objectiveIds).size !== objectiveIds.length) {
    return { ok: false, reason: 'objective-ids' }
  }
  if (
    !Array.isArray(value.collectedObjectiveIds) ||
    value.collectedObjectiveIds.some(
      (id) => !stableId(id) || !objectiveIds.includes(id as string)
    ) ||
    new Set(value.collectedObjectiveIds).size !== value.collectedObjectiveIds.length
  ) {
    return { ok: false, reason: 'collected-objectives' }
  }
  if (!coordinate(value.exit, width, height)) return { ok: false, reason: 'exit' }
  if (!Array.isArray(value.actors) || value.actors.length !== 2) {
    return { ok: false, reason: 'actors' }
  }
  const actorIds = new Set<string>()
  for (const item of value.actors) {
    if (
      !record(item) ||
      !exactKeys(item, ['id', 'status']) ||
      (item.id !== 'player' && item.id !== 'companion') ||
      (item.status !== 'free' && item.status !== 'captured')
    ) {
      return { ok: false, reason: 'actor' }
    }
    actorIds.add(item.id)
  }
  if (actorIds.size !== 2) return { ok: false, reason: 'actor-ids' }
  return { ok: true, value: structuredClone(value) as unknown as ShadowChaseVoiceContext }
}
