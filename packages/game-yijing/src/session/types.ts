// Session state shape for the yijing-oracle 5-screen flow.
// The reading screen is a staged classical-text reveal (no AI, no voice):
// `stage` tracks how much of the reading has been revealed.

import type { YaoSextet } from '../glyphs/utils'

/** Stable identifiers for the 6 projection images (handoff §6.2). */
export type ProjArtId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'

/** Staged-reveal progress on the reading screen.
 *  0 = 本卦 judgment, 1 = + changing-line texts, 2 = + 变卦 judgment (complete). */
export type RevealStage = 0 | 1 | 2

export interface SessionState {
  /** Player's projection choices — FIFO, max length 2 (handoff §8 / §6.2). */
  picked: ProjArtId[]

  /** Six yao values produced by the casting engine; null until cast completes. */
  yaoValues: YaoSextet | null

  /** ISO timestamp for the cast that produced `yaoValues`; null until cast completes. */
  castCreatedAt: string | null

  /** Staged-reveal progress on the reading screen. */
  stage: RevealStage

  /** Per-session identifier; new value each `reset()` (used by sign-generator). */
  sessionId: string
}

export interface SessionActions {
  /** Append to `picked`; if already 2 items, drop the oldest then append (FIFO). */
  pickImage: (id: ProjArtId) => void
  /** Empty the projection picks without touching the rest of the session. */
  clearPicks: () => void
  /** Record the cast result. */
  setYaoValues: (values: YaoSextet) => void
  /** Advance / set the reading reveal stage. */
  setStage: (stage: RevealStage) => void
  /** Wipe all session state and mint a fresh sessionId — used by "再问一次". */
  reset: () => void
}

export type SessionContextValue = SessionState & SessionActions
