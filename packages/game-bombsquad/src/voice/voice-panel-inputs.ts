/**
 * Pure wiring seam between the live BombSquad game state and the voice-session
 * hook inputs. Side-effect-free (no React, no I/O) so the mode②-gating and the
 * current-module -> `relevantSections` derivation are unit-testable without a
 * browser. `GamePage` consumes these to mount `VoicePanel` only for an opted-in
 * daily run, and to remount it (fresh session) on every module advance.
 */

import type { GameState as BombSquadGameState, GameMode, ModuleKind } from '@/store/game-context'
import type { GameState as VoiceGameState, ManualData } from '@amiclaw/platform-ai/contract'
import { bombsquadManualToManualData, moduleKindToRelevantSections } from './manual-data'

/** Query-param value that opts a daily run into the platform voice partner (mode②). */
export const MODE2_PARTNER_PARAM = 'partner'
export const MODE2_PARTNER_VALUE = 'platform'

/**
 * mode②-gating. The in-game platform voice partner mounts only on a DAILY run
 * explicitly opted in via `?partner=platform`. Practice runs and an un-opted
 * daily run stay mode① (BYO-AI) and never mount the panel — keeping mode① the
 * default and fully unchanged.
 */
export function isPlatformVoicePartner(mode: GameMode, partnerParam: string | null): boolean {
  return mode === 'daily' && partnerParam === MODE2_PARTNER_VALUE
}

export interface VoicePanelInputs {
  /** Per-run manual payload for the voice session. */
  manualData: ManualData
  /** Drives the platform's manual-subset selection for the current module. */
  gameState: VoiceGameState
  /**
   * Stable per-module identity. Used as the `VoicePanel` React `key`, so when
   * the player advances modules the panel tears down (WS/mic/AudioContext) and
   * reconnects with the new module's `relevantSections` — the locked
   * per-module-session model.
   */
  moduleKey: string
  /** The current module kind (surfaced for labelling / callers). */
  moduleKind: ModuleKind
}

/**
 * Derive the voice-session inputs from the live game state for the current
 * module. Returns null until the manual is loaded and a current module kind
 * exists — the panel stays unmounted (and the hook idle) until then. Pure: it
 * reads game state and the Round-1 transformers only, never game logic.
 */
export function deriveVoicePanelInputs(state: BombSquadGameState): VoicePanelInputs | null {
  const moduleKind = state.moduleSequence[state.currentModuleIndex]
  if (!moduleKind || state.manual === null) return null
  return {
    manualData: bombsquadManualToManualData(state.manual, state.manual.meta.version),
    gameState: { relevantSections: moduleKindToRelevantSections(moduleKind) },
    moduleKey: `${state.currentModuleIndex}-${moduleKind}`,
    moduleKind,
  }
}
