import type { WireConfig, WireAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import { matchCondition } from '../../engine/rule-engine'

/**
 * Finds the first matching rule and returns the cut target.
 * Returns null if no rule matches (should not happen with a valid manual).
 */
export function solveWire(
  config: WireConfig,
  rules: ManualModules['wire_routing']['rules'],
  sceneInfo: SceneInfo,
): WireAnswer | null {
  for (const rule of rules) {
    if (matchCondition(rule.condition, config as unknown as Record<string, unknown>, sceneInfo)) {
      const pos = resolvePosition(rule.target, config)
      if (pos === null) continue
      return { type: 'wire', cutPosition: pos }
    }
  }
  return null
}

function resolvePosition(
  target: { position: 'first' | 'last' | number; color?: string },
  config: WireConfig,
): number | null {
  const { wires } = config
  if (target.position === 'first') {
    if (target.color) {
      const idx = wires.findIndex(w => w.color === target.color)
      return idx >= 0 ? idx : null
    }
    return 0
  }
  if (target.position === 'last') {
    if (target.color) {
      let idx = -1
      for (let i = 0; i < wires.length; i++) {
        if (wires[i].color === target.color) idx = i
      }
      return idx >= 0 ? idx : null
    }
    return wires.length - 1
  }
  const n = target.position as number
  return n >= 0 && n < wires.length ? n : null
}
