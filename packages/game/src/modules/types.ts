import type { ModuleConfig, ModuleAnswer, SceneInfo } from '@shared/manual-schema'

export interface ModuleProps<C extends ModuleConfig, A extends ModuleAnswer> {
  config: C
  answer: A
  onComplete: () => void   // called when the player succeeds
  onError: () => void      // called when the player makes a wrong move
  sceneInfo: SceneInfo
}
