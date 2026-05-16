import type { SceneInfo } from '@shared/manual-schema'

/**
 * Evaluates a single condition value against an actual value.
 * Supports: exact equality, {gt}, {gte}, {lt}, {lte}, {odd}, {even}, {present}
 */
export function matchValue(condition: unknown, actual: unknown): boolean {
  if (condition === null || condition === undefined) return true
  if (typeof condition === 'object' && condition !== null) {
    const c = condition as Record<string, unknown>
    if ('gt' in c) return typeof actual === 'number' && actual > (c.gt as number)
    if ('gte' in c) return typeof actual === 'number' && actual >= (c.gte as number)
    if ('lt' in c) return typeof actual === 'number' && actual < (c.lt as number)
    if ('lte' in c) return typeof actual === 'number' && actual <= (c.lte as number)
    if ('odd' in c) return typeof actual === 'number' && (actual % 2 !== 0) === c.odd
    if ('even' in c) return typeof actual === 'number' && (actual % 2 === 0) === c.even
    if ('present' in c) return (actual !== undefined && actual !== null) === c.present
  }
  return condition === actual
}

/**
 * Matches a condition object against module config + scene info.
 * Returns true if ALL keys in the condition match.
 */
export function matchCondition(
  condition: Record<string, unknown>,
  config: Record<string, unknown>,
  sceneInfo: SceneInfo
): boolean {
  const context = buildContext(config, sceneInfo)
  return Object.entries(condition).every(([key, value]) => {
    if (!(key in context)) return false
    return matchValue(value, context[key])
  })
}

/**
 * Builds a flat context object from module config + scene info
 * for condition key lookups.
 */
function buildContext(
  config: Record<string, unknown>,
  sceneInfo: SceneInfo
): Record<string, unknown> {
  const ctx: Record<string, unknown> = { ...config }

  // Scene info fields
  ctx['battery_count'] = sceneInfo.batteryCount

  // Indicator lookups: indicator_{label}_lit (e.g. indicator_FRK_lit)
  for (const ind of sceneInfo.indicators) {
    ctx[`indicator_${ind.label}_lit`] = ind.lit
  }

  // Wire-specific computed fields
  if (Array.isArray(config['wires'])) {
    const wires = config['wires'] as Array<{ color: string; hasStripe: boolean }>
    ctx['wire_count'] = wires.length
    ctx['color_at_last'] = wires[wires.length - 1]?.color
    ctx['color_at_first'] = wires[0]?.color
    // Count each color
    for (const color of ['red', 'blue', 'yellow', 'green', 'white', 'black']) {
      ctx[`count_${color}`] = wires.filter((w) => w.color === color).length
    }
  }

  return ctx
}
