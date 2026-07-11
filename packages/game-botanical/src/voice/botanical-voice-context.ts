/**
 * Botanical-specific voice-session config for the shared
 * `@shared/voice/use-game-voice-session` hook (the platform game-voice client
 * Shadow-Chase / BombSquad also use). Mirrors `shadow-chase-context.ts`.
 *
 * Hidden-info coop: the botanist does NOT receive the garden scene — only WHICH
 * manual sections to inject (steered by the live garden). The gardener describes
 * what they see; the botanist grounds every answer on the injected manual. So the
 * voice GameState carries `relevantSections` only, never a scene `publicContext`.
 */
import type { GameVoiceGuards, GameVoiceState } from '@shared/voice/use-game-voice-session'
import { gardenStateToRelevantSections } from './relevant-sections'

/**
 * Bounded lifecycle/cost guards. The garden is slower-paced and chattier than
 * Shadow-Chase (many plants, contemplative care), so the silence + turn + duration
 * budgets are larger than `SHADOW_CHASE_VOICE_GUARDS`.
 */
export const BOTANICAL_VOICE_GUARDS: GameVoiceGuards = {
  connectMs: 5_000,
  responseMs: 12_000,
  silenceMs: 60_000,
  maxPlayerTurns: 30,
  maxDurationMs: 600_000,
}

export interface BotanicalPlantForVoice {
  id: string
  species: string
  health: string
}

/** The voice GameState: manual-subset selection steered by the live garden. */
export function buildBotanicalVoiceState(input: {
  plants: BotanicalPlantForVoice[]
  focusedId: string | null
  availableSectionIds: string[]
}): GameVoiceState {
  return { relevantSections: gardenStateToRelevantSections(input) }
}
