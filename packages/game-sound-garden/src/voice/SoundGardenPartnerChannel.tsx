import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  useGameVoiceSession,
  type GameVoiceGuards,
  type GameVoiceManualData,
} from '@shared/voice/use-game-voice-session'
import type { CoBuildAction } from '@shared/voice/voice-session-protocol'
import type { ConversationPhase, VoiceStatus } from '@shared/voice/voice-session-protocol'
import {
  STARBURST_DEPLETED_FAREWELL,
  STARBURST_EARN_CTA_LABEL,
  STARBURST_INSUFFICIENT_LEAD,
} from '@shared/reward-types'
import type { PieceType } from '../game/constants'
import type { GameStore } from '../game/store'
import type { PartnerAction } from '../game/types'

/**
 * mode② partner channel — the account companion as the 园丁 co-builder, over the
 * shared `@shared/voice/use-game-voice-session` hook (the same client BombSquad /
 * Botanical use), same-origin to the platform Worker with `gameId:'sound-garden'`.
 *
 * Wiring (on top of the PR-1 protocol):
 *  - `onAction` — the partner's co_build moves flow through the SAME client
 *    legality guard the scripted partner uses (`store.applyPartnerActions`) into
 *    the engine as the partner role. Barge-in / closing-turn suppression come
 *    free from PR-1 (the hook drops a barged turn's action; the recap never moves).
 *  - `getGameState` — the live board (`store.voiceGameState`) is pulled on each
 *    speech-start; the memoized `gameState` also re-steers the session on every
 *    board change (the hook diffs the signature), so the partner always reasons
 *    against the current lanes/score.
 *
 * Hands-free once started; the mic opens behind the「呼叫伙伴」gesture (getUserMedia
 * needs one). Dark-only, CSS-only animation.
 */

export const SOUND_GARDEN_VOICE_GUARDS: GameVoiceGuards = {
  connectMs: 5_000,
  responseMs: 15_000,
  silenceMs: 45_000,
  maxPlayerTurns: 24,
  maxDurationMs: 600_000,
}

interface SoundGardenPartnerChannelProps {
  store: GameStore
  /** `'sound-garden'` (companion) in production. */
  gameId: string
  manualData: GameVoiceManualData
}

const PHASE_LABEL: Record<ConversationPhase, string> = {
  listening: '聆听中',
  thinking: '思考中',
  speaking: '说话中',
}

const STATUS_LABEL: Partial<Record<VoiceStatus, string>> = {
  idle: '准备中',
  connecting: '连接中',
  error: '连接出错',
  closed: '已结束',
}

function coBuildToPartnerActions(actions: CoBuildAction[]): PartnerAction[] {
  // The server parse-guard already validated op ∈ {place,remove} + pieceType ∈ the
  // Sound Garden vocabulary; the store's `filterLegalActions` re-validates lane /
  // range / material against the live board, so this cast is safe.
  return actions.map((a) => ({ op: a.op, pieceType: a.pieceType as PieceType, slot: a.slot }))
}

function SoundGardenPartnerChannelImpl({
  store,
  gameId,
  manualData,
}: SoundGardenPartnerChannelProps) {
  const gameStoreState = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // Board-derived voice game state: re-memoized whenever the store state changes,
  // so the hook re-steers (update-gamestate) on every board change. `voiceGameState`
  // reads the store's live snapshot, so `gameStoreState` is the deliberate recompute
  // trigger even though it is not textually referenced in the memo body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gameState = useMemo(() => store.voiceGameState(), [store, gameStoreState])

  const onAction = useCallback(
    (actions: CoBuildAction[]) => {
      store.applyPartnerActions(coBuildToPartnerActions(actions))
    },
    [store]
  )
  const getGameState = useCallback(() => store.voiceGameState(), [store])

  const {
    status,
    conversationPhase,
    aiText,
    playerTranscript,
    isAiSpeaking,
    error,
    errorCode,
    summaryReason,
    openSession,
    endSession,
    requestClosing,
  } = useGameVoiceSession({
    manualData,
    gameState,
    gameId,
    onAction,
    getGameState,
    guards: SOUND_GARDEN_VOICE_GUARDS,
    sessionNamePrefix: 'sound-garden',
    // getUserMedia needs a user gesture → connect on the「呼叫伙伴」click.
    autoConnect: false,
  })

  // Settlement recap (§4): on the FIRST bloom, ask the platform partner for its
  // closing line. Fire-and-forget, once per run — closing turns are action-free by
  // PR-1 design (the partner speaks a recap, it does not move the board). Bloom is
  // the win outcome, so it maps to the `defused` recap register; resolves
  // immediately (a no-op) if the session is not live.
  const closingSentRef = useRef(false)
  useEffect(() => {
    if (gameStoreState.settled && !closingSentRef.current && status === 'ready') {
      closingSentRef.current = true
      void requestClosing('defused')
    }
  }, [gameStoreState.settled, status, requestClosing])

  const isLive = status === 'ready'
  const notStarted = status === 'idle' || status === 'closed' || status === 'error'
  const indicatorLabel = isLive
    ? PHASE_LABEL[conversationPhase]
    : (STATUS_LABEL[status] ?? '准备中')

  if (notStarted) {
    return (
      <section className="sg-voice" aria-label="AI 伙伴语音">
        <button type="button" className="sg-btn primary" onClick={() => openSession()}>
          {status === 'idle' ? '呼叫伙伴' : '重新连接'}
        </button>
        {error && errorCode !== 'insufficient-balance' && (
          <p className="sg-voice-error" role="alert">
            {error}
          </p>
        )}
        {/* Insufficient-balance intercept (reward-economy §5): the pricing gate
            refused the voice open — a warm narrative line + an earn CTA, not a
            raw server error. NO companion-voice narration (locked Boundary). */}
        {errorCode === 'insufficient-balance' && (
          <div className="sg-voice-intercept" role="status">
            <p>{STARBURST_INSUFFICIENT_LEAD}</p>
            <a className="sg-voice-intercept-cta" href="/">
              {STARBURST_EARN_CTA_LABEL}
              <span aria-hidden="true"> →</span>
            </a>
          </div>
        )}
        {/* Mid-session depletion farewell (reward-economy §5 wind-down). */}
        {summaryReason === 'balance-depleted' && (
          <p className="sg-voice-farewell" role="status">
            {STARBURST_DEPLETED_FAREWELL}
          </p>
        )}
        <p className="sg-voice-hint">
          点「呼叫伙伴」授权麦克风，伙伴会先打招呼；随后直接对它说话即可。
        </p>
      </section>
    )
  }

  return (
    <section className="sg-voice" aria-label="AI 伙伴语音">
      <div className="sg-voice-head">
        <span className="sg-voice-status">
          <span
            className="sg-voice-dot"
            data-status={status}
            data-phase={isLive ? conversationPhase : undefined}
            aria-hidden="true"
          />
          <span className="sg-voice-statustext" role="status">
            {indicatorLabel}
          </span>
        </span>
        {isLive && isAiSpeaking && (
          <span className="sg-voice-speaking" role="status" aria-label="伙伴正在说话">
            <span className="sg-voice-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
        )}
      </div>

      {playerTranscript && (
        <p className="sg-voice-you" aria-label="你说的话">
          <span className="sg-voice-label">你：</span>
          {playerTranscript}
        </p>
      )}

      <div className="sg-voice-reply" role="status" aria-live="polite">
        {aiText ? (
          <p aria-label="伙伴说的话">
            <span className="sg-voice-label">伙伴：</span>
            {aiText}
          </p>
        ) : (
          <p className="sg-voice-placeholder">开口说话，伙伴会即时回应并在花园里搭手</p>
        )}
      </div>

      {error && (
        <p className="sg-voice-error" role="alert">
          {error}
        </p>
      )}

      <div className="sg-voice-foot">
        <p className="sg-voice-hint">免提对话已开启，直接对伙伴说话即可。</p>
        <button type="button" className="sg-btn ghost" onClick={endSession}>
          结束对话
        </button>
      </div>
    </section>
  )
}

/** Memoized so the transport/playhead re-render does not re-render the panel. */
const SoundGardenPartnerChannel = memo(SoundGardenPartnerChannelImpl)
export default SoundGardenPartnerChannel
