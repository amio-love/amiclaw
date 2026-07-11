/**
 * Piece taxonomy + display metadata + the relation→score map.
 *
 * The 8 piece types (4 rhythm + 4 melody) are the fixed sound-garden
 * vocabulary (game-type.yaml). Display labels are Chinese instantiation data;
 * melody frequencies are a fixed pentatonic set so any combination sounds
 * musical (lifted from the validated rough-cut synth recipe). The relation
 * scores are DERIVED from the loaded GameType so they can never drift from
 * what the engine actually scores.
 */

import { SOUND_GARDEN_GAME_TYPE } from './gametype'
import type { RelationName } from './types'

export const RHYTHM_TYPES = ['kick', 'snare', 'hihat', 'clap'] as const
export const MELODY_TYPES = ['bell', 'chime', 'flute', 'harp'] as const

export type RhythmType = (typeof RHYTHM_TYPES)[number]
export type MelodyType = (typeof MELODY_TYPES)[number]
export type PieceType = RhythmType | MelodyType

export interface PieceMeta {
  emoji: string
  label: string
  /** Fundamental pitch (Hz) for melody voices; absent for rhythm voices. */
  freq?: number
}

export const PIECE_META: Record<PieceType, PieceMeta> = {
  // rhythm roots (earthy percussion)
  kick: { emoji: '🥁', label: '底鼓' },
  snare: { emoji: '🪘', label: '军鼓' },
  hihat: { emoji: '💠', label: '踩镲' },
  clap: { emoji: '👏', label: '拍掌' },
  // melody flowers (fixed pentatonic pitches)
  bell: { emoji: '🔔', label: '铃铛', freq: 523.25 }, // C5
  chime: { emoji: '🎐', label: '风铃', freq: 659.25 }, // E5
  flute: { emoji: '🪈', label: '笛音', freq: 783.99 }, // G5
  harp: { emoji: '🎶', label: '竖琴', freq: 880.0 }, // A5
}

/** relation → points, derived from the GameType's harmony_rule template. */
export const RELATION_SCORES: Record<RelationName, number> = (() => {
  const template = SOUND_GARDEN_GAME_TYPE.rule_templates.find(
    (t) => t.type === 'interaction_matrix'
  )
  const scores =
    template && template.type === 'interaction_matrix'
      ? template.matrix_schema.relation_scores
      : undefined
  if (!scores) throw new Error('sound-garden GameType is missing relation_scores')
  return {
    synergy: scores.synergy ?? 3,
    compatible: scores.compatible ?? 2,
    neutral: scores.neutral ?? 1,
    incompatible: scores.incompatible ?? -1,
  }
})()

/** Per-pair feedback shown after both lanes fill a slot (never the full matrix). */
export const RELATION_FEEDBACK: Record<RelationName, { text: string }> = {
  synergy: { text: '✨ 共鸣' },
  compatible: { text: '🌿 和谐' },
  neutral: { text: '· 平淡' },
  incompatible: { text: '⚡ 刺耳' },
}
