// Session state shape for the yijing-oracle 5-screen flow.
// Sibling 1 scaffold — sibling 2 wires real interactions into the actions.
// Phase mapping per handoff §8 + design doc §AI 融合推测流程.

import type { YaoSextet } from '../glyphs/utils'

/** Stable identifiers for the 6 projection images (handoff §6.2). */
export type ProjArtId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'

/** Cold-reading sub-phase during the reading screen.
 *  0 = initial AI guess, 1 = after player correction, 2 = deep interpretation. */
export type ColdReadingPhase = 0 | 1 | 2

/** Voice I/O visual state used by the reading screen mic indicator. */
export type VoiceState = 'speaking' | 'listening' | 'idle'

export interface SessionState {
  /** Player's projection choices — FIFO, max length 2 (handoff §8 / §6.2). */
  picked: ProjArtId[]

  /** Six yao values produced by the casting engine; null until cast completes. */
  yaoValues: YaoSextet | null

  /** Cold-reading sub-phase on the reading screen. */
  phase: ColdReadingPhase

  /** Voice indicator state. */
  voiceState: VoiceState

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
  /** Advance / set the cold-reading sub-phase. */
  setPhase: (phase: ColdReadingPhase) => void
  /** Update the voice indicator state. */
  setVoiceState: (state: VoiceState) => void
  /** Wipe all session state and mint a fresh sessionId — used by "再问一次". */
  reset: () => void
}

export type SessionContextValue = SessionState & SessionActions
