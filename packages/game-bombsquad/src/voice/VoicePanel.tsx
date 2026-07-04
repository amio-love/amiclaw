import { memo, useImperativeHandle, forwardRef } from 'react'
import type { GameState, ManualData } from '@amiclaw/platform-ai/contract'
import { useVoiceSession } from './useVoiceSession'
import type { ConversationPhase, VoiceStatus } from './voice-session-protocol'
import styles from './VoicePanel.module.css'

interface VoicePanelProps {
  /** Stable per-run join key shared by voice summary and score settlement. */
  gameRunId: string
  /** Per-run manual payload (`null` while the manual is still loading). */
  manualData: ManualData | null
  /** Game state driving the manual-subset selection for this module. */
  gameState: GameState
  /** Platform game id; defaults to `'bombsquad'` inside the hook. */
  gameId?: string
}

/**
 * Imperative handle exposed by VoicePanel via `ref`. GamePage uses this to
 * trigger the closing-recap turn and gate results-screen navigation on it.
 */
export interface VoicePanelHandle {
  /**
   * Request the closing-recap turn. Returns a promise that resolves when the
   * recap audio has finished playing. Resolves immediately if the session is
   * not live. See `useVoiceSession.requestClosing` for the full contract.
   */
  requestClosing: () => Promise<void>
}

/**
 * In-game voice panel for the BombSquad daily run (mode②), hands-free. Renders
 * the `useVoiceSession` surface: a prominent 3-state conversation indicator
 * (聆听中 / 思考中 / 说话中) once the session is live, the connection status before
 * that, the player's own recognized-speech subtitle (你：…) streaming live as
 * recognition builds, the AI's streamed text reply, and a bounded error line.
 * There is NO
 * push-to-talk — the mic streams continuously and the AI greets first; the player
 * just talks. Presentation only: it reads hook state and never touches game logic
 * or the mic/socket. Dark-only, CSS-only animation (Atlas design system).
 */

/** Connection-status copy for the non-live states. Chinese — daily players read it. */
const STATUS_LABEL: Record<Exclude<VoiceStatus, 'ready'>, string> = {
  idle: '准备中',
  connecting: '连接中',
  error: '连接出错',
  closed: '已结束',
}

/** The 3-state conversation phase copy (shown while the session is live). */
const PHASE_LABEL: Record<ConversationPhase, string> = {
  listening: '聆听中',
  thinking: '思考中',
  speaking: '说话中',
}

function placeholderFor(status: VoiceStatus, phase: ConversationPhase): string {
  if (status === 'ready') {
    if (phase === 'thinking') return 'AI 正在思考…'
    if (phase === 'speaking') return 'AI 正在回应…'
    return '开口说话，AI 会即时回应'
  }
  if (status === 'closed') return '语音通话已结束'
  if (status === 'error') return '语音连接已断开'
  return '正在接通 AI 语音…'
}

function VoicePanelImpl(
  { gameRunId, manualData, gameState, gameId }: VoicePanelProps,
  ref: React.ForwardedRef<VoicePanelHandle>
) {
  const {
    status,
    conversationPhase,
    aiText,
    playerTranscript,
    isAiSpeaking,
    error,
    requestClosing,
  } = useVoiceSession({
    gameRunId,
    manualData,
    gameState,
    gameId,
  })

  useImperativeHandle(ref, () => ({ requestClosing }), [requestClosing])

  const isLive = status === 'ready'
  // While live, the prominent indicator is the conversation phase; before that
  // it is the connection status.
  const indicatorLabel = isLive ? PHASE_LABEL[conversationPhase] : STATUS_LABEL[status]

  return (
    <section className={styles.panel} aria-label="AI 语音伙伴">
      <div className={styles.header}>
        <span className={styles.status}>
          <span
            className={styles.statusDot}
            data-status={status}
            data-phase={isLive ? conversationPhase : undefined}
            aria-hidden="true"
          />
          <span className={styles.statusText} role="status">
            {indicatorLabel}
          </span>
        </span>
        {isLive && isAiSpeaking && (
          <span className={styles.speaking} role="status" aria-label="AI 正在说话">
            <span className={styles.speakingDots} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
        )}
      </div>

      {playerTranscript && (
        <p className={styles.playerTranscript} aria-label="你说的话">
          <span className={styles.playerTranscriptLabel}>你：</span>
          {playerTranscript}
        </p>
      )}

      <div className={styles.reply} role="log" aria-live="polite">
        {aiText ? (
          <p className={styles.replyText}>{aiText}</p>
        ) : (
          <p className={styles.replyPlaceholder}>{placeholderFor(status, conversationPhase)}</p>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <p className={styles.hint}>免提对话已开启，直接对 AI 说话即可，无需按键。</p>
    </section>
  )
}

/**
 * Memoized so the ~60fps GamePage timer re-render does not re-render the panel:
 * with the stable, memoized `manualData` / `gameState` props from GamePage it
 * only re-renders on its own hook-state changes. `forwardRef` wraps first so
 * the ref flows through the memo boundary to `useImperativeHandle` inside.
 */
const VoicePanel = memo(forwardRef<VoicePanelHandle, VoicePanelProps>(VoicePanelImpl))
export default VoicePanel
