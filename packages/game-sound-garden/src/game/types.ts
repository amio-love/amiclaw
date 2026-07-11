/**
 * Presentation-layer types for the Sound Garden probe.
 *
 * These sit ABOVE the creation engine: the engine knows nothing about
 * scarcity, slot exclusivity, or sides — those are all presentation concerns
 * (L2 arch note A4 / F1 / F2). The engine only sees the Level that build_level
 * produces from a LevelConfig.
 */

import type { MelodyType, PieceType, RhythmType } from './constants'

export type RelationName = 'synergy' | 'compatible' | 'neutral' | 'incompatible'

/** rhythm_type → melody_type → relation. Each level supplies its own. */
export type HarmonyMatrix = Record<RhythmType, Record<MelodyType, RelationName>>

/** Which archetype the PLAYER controls. Partner takes the other (side-swap). */
export type Side = 'melody' | 'rhythm'

export type Archetype = 'melody_piece' | 'rhythm_piece'
export type Role = 'melody_builder' | 'rhythm_builder'

/** A per-type material pool (presentation-owned scarcity — engine-inert). */
export type Pool = Partial<Record<PieceType, number>>

export interface LevelConfig {
  id: string
  /** 1-based level number. */
  index: number
  /** Short Chinese name, e.g. 学步 / 取舍 / 荆棘. */
  name: string
  subtitle: string
  slots: number
  /** score_threshold win target. */
  target: number
  matrix: HarmonyMatrix
  /** Material pool for the MELODY lane (whoever controls it). Lane-scoped, not player-scoped. */
  melodyPool: Pool
  /** Material pool for the RHYTHM lane (whoever controls it). Lane-scoped, not player-scoped. */
  rhythmPool: Pool
  /** One-line tension description surfaced on the level card. */
  tension: string
}

/** Immutable board view handed to the partner brain each turn. */
export interface BoardSnapshot {
  slots: number
  /** melody[slotIndex] = melody type placed there, or null. slotIndex is 0-based. */
  melody: (MelodyType | null)[]
  rhythm: (RhythmType | null)[]
  score: number
  target: number
  bloomed: boolean
  /** Remaining counts for the partner's own pool (its scarcity). */
  partnerRemaining: Pool
  /** Remaining counts for the player's pool (visible to the partner). */
  playerRemaining: Pool
  /** Which archetype the partner controls this session. */
  partnerArchetype: Archetype
  trigger: PartnerTrigger
}

export type PartnerTrigger = 'session_start' | 'player_planted' | 'player_spoke' | 'idle'

/** A single partner move. `slot` is 1-based (matches timeline_slot). */
export interface PartnerAction {
  op: 'place' | 'remove'
  pieceType: PieceType
  slot: number
}

export interface PartnerReaction {
  speech: string
  actions: PartnerAction[]
}

/** One chat line in the partner strip. */
export interface ChatLine {
  seq: number
  text: string
  speaker: 'partner' | 'player'
}
