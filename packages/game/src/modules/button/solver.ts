import type { ButtonConfig, ButtonAnswer, SceneInfo } from '@shared/manual-schema'
import type { ManualModules } from '@shared/manual-schema'
import { matchCondition } from '../../engine/rule-engine'

export function solveButton(
  config: ButtonConfig,
  rules: ManualModules['button']['rules'],
  sceneInfo: SceneInfo,
): ButtonAnswer | null {
  for (const rule of rules) {
    if (matchCondition(
      rule.condition,
      config as unknown as Record<string, unknown>,
      sceneInfo,
    )) {
      return {
        type: 'button',
        action: rule.action.type,
        releaseOnColor: rule.action.type === 'hold' ? rule.action.release_on_light : undefined,
      }
    }
  }
  return null
}
