import type { GameVoiceManualData } from '@shared/voice/use-game-voice-session'
import { RELATION_SCORES } from '../game/constants'
import type { LevelConfig } from '../game/types'

/**
 * The per-run manual for the mode② partner. The harmony matrix is the coop hidden
 * info: it rides here as `sections.matrix` (client → `create`), injected
 * server-side as the authoritative manual (never shown to the player). This keeps
 * the probe's existing UI-only hidden-info model — matrix is client-held, not
 * server-authoritative (⚠ the same tradeoff as BombSquad's client-side answer
 * calc; flagged, not silently claimed as server-secret). The static `rules`
 * section gives the partner the scoring model + this level's target.
 */
export function buildSoundGardenManualData(level: LevelConfig): GameVoiceManualData {
  return {
    version: level.id,
    sections: {
      matrix: level.matrix,
      rules: {
        target: level.target,
        slots: level.slots,
        relation_scores: RELATION_SCORES,
        summary:
          '同一拍两侧都有元素才计分：synergy 最好、compatible 次之、neutral 平淡、incompatible 会倒扣。' +
          '用有限的材料把元素放在最能共鸣的拍上，让和声总分达到 target，花园就会绽放。',
      },
    },
  }
}
