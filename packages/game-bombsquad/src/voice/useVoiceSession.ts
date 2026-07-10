/** BombSquad compatibility adapter over the shared game voice session. */
import type {
  GameState,
  ManualData,
  RecapOutcome,
  SessionSummary,
} from '@amiclaw/platform-ai/contract'
import {
  useGameVoiceSession,
  type UseGameVoiceSessionResult,
} from '@shared/voice/use-game-voice-session'

export interface UseVoiceSessionOptions {
  gameRunId?: string
  manualData: ManualData | null
  gameState: GameState
  gameId?: string
  streakDays?: number
}

export interface UseVoiceSessionResult extends Omit<
  UseGameVoiceSessionResult,
  'summary' | 'requestClosing' | 'openSession' | 'closeSession' | 'updateGameState' | 'errorCode'
> {
  summary: SessionSummary | null
  requestClosing: (outcome?: RecapOutcome) => Promise<void>
  endSession: () => void
}

export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSessionResult {
  return useGameVoiceSession(options) as UseVoiceSessionResult
}
