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
  // `sendText` is the shared hook's typed-input fallback; BombSquad is voice-only
  // (no typed channel), so it is narrowed away here to keep BombSquad's public
  // result surface unchanged — same as openSession/closeSession/updateGameState.
  | 'summary'
  | 'requestClosing'
  | 'openSession'
  | 'closeSession'
  | 'updateGameState'
  | 'errorCode'
  | 'sendText'
> {
  summary: SessionSummary | null
  requestClosing: (outcome?: RecapOutcome) => Promise<void>
  endSession: () => void
}

export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSessionResult {
  return useGameVoiceSession(options) as UseVoiceSessionResult
}
