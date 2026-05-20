import type { ModuleConfig, ModuleAnswer, SceneInfo } from '@shared/manual-schema'
import type { GameMode } from '@/store/game-context'

export interface ModuleProps<C extends ModuleConfig, A extends ModuleAnswer> {
  config: C
  answer: A
  onComplete: () => void // called when the player succeeds
  onError: () => void // called when the player makes a wrong move
  sceneInfo: SceneInfo
  mode: GameMode // current game mode — daily vs practice
}
