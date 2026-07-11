import type { GameVoiceManualData, GameVoiceState } from '@shared/voice/use-game-voice-session'

import { getMap } from '../engine/maps'
import { PURSUER_RULE_CONTRACT, PURSUER_RULE_COPY } from '../engine/pursuer-rules'
import type { CompanionIntent, Coordinate, SimulationState } from '../engine/types'

export const SHADOW_CHASE_RULES_SECTION = 'shadow-chase-rules'
export const MAX_SHADOW_CHASE_MANUAL_BYTES = 4_096

export interface ShadowChaseVoiceContext {
  version: 1
  phase: 'planning' | 'running'
  strategy: CompanionIntent
  allowedStrategies: ['support', 'scout', 'anchor']
  map: { id: string; width: number; height: number; walls: Coordinate[] }
  objectives: Array<{ id: string; position: Coordinate }>
  collectedObjectiveIds: string[]
  exit: Coordinate
  actors: Array<{ id: 'player' | 'companion'; status: 'free' | 'captured' }>
}

export const SHADOW_CHASE_VOICE_MANUAL: GameVoiceManualData = {
  version: 'shadow-chase-voice-v1',
  sections: {
    [SHADOW_CHASE_RULES_SECTION]: {
      goal: 'Collect all three light cores to open the moon gate immediately, then exit together.',
      authority:
        'The deterministic engine owns movement, collision, pursuit, rescue, swap charges, and outcomes.',
      pursuerRule: PURSUER_RULE_COPY,
      pursuerContract: PURSUER_RULE_CONTRACT,
      strategies: {
        support: 'Stay near the player to shorten rescue routes, while avoiding pursuer contact.',
        scout:
          'Move near the next light core without collecting it so the player can plan a route.',
        anchor:
          'Move far from the player to create a strong swap destination at the cost of rescue time.',
      },
      voiceCommands:
        'Only an explicit final player utterance may request support, scout, or anchor. Assistant prose is informational.',
    },
  },
}

export function buildShadowChaseVoiceContext(
  state: SimulationState,
  phase: 'planning' | 'running',
  strategy: CompanionIntent
): ShadowChaseVoiceContext {
  const map = getMap(state.mapId)
  return {
    version: 1,
    phase,
    strategy,
    allowedStrategies: ['support', 'scout', 'anchor'],
    map: {
      id: map.id,
      width: map.width,
      height: map.height,
      walls: map.walls.map((wall) => ({ ...wall })),
    },
    objectives: state.objectives.map((objective) => ({
      id: objective.id,
      position: { ...objective.position },
    })),
    collectedObjectiveIds: state.objectives
      .filter((objective) => objective.collected)
      .map((objective) => objective.id),
    exit: { ...state.exit.position },
    actors: (['player', 'companion'] as const).map((id) => ({
      id,
      status: state.actors[id].status,
    })),
  }
}

export function buildShadowChaseVoiceState(
  state: SimulationState,
  phase: 'planning' | 'running',
  strategy: CompanionIntent
): GameVoiceState {
  return {
    relevantSections: [SHADOW_CHASE_RULES_SECTION],
    publicContext: buildShadowChaseVoiceContext(state, phase, strategy),
  }
}

export function shadowChaseVoiceStateSignature(state: GameVoiceState): string {
  return JSON.stringify(state)
}

export function serializedVoiceManualBytes(): number {
  return new TextEncoder().encode(JSON.stringify(SHADOW_CHASE_VOICE_MANUAL)).byteLength
}
