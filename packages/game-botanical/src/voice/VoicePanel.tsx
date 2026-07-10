import { memo } from 'react'
import type { GameState, ManualData } from '@amiclaw/platform-ai/contract'
import { useVoiceSession } from './useVoiceSession'
import type { ConversationPhase, VoiceStatus } from './voice-session-protocol'
import TextPanel from './TextPanel'
import styles from './VoicePanel.module.css'

interface VoicePanelProps {
  /** Per-run manual payload (`null` while the manual is still loading). */
  manualData: ManualData | null
  /** Live game state driving the manual-subset selection for this turn. */
  gameState: GameState
  /** Platform game id; defaults to `'demo-mock'` inside the hook. */
  gameId?: string
}

/** Connection-status copy for the non-live states. Chinese. */
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
    if (phase === 'thinking') return '植物学家正在思考…'
    if (phase === 'speaking') return '植物学家正在回应…'
    return '开口说话，植物学家会即时回应'
  }
  if (status === 'closed') return '语音对话已结束'
  if (status === 'error') return '语音连接已断开'
  return '正在接通植物学家…'
}

/**
 * In-game voice panel for the Botanical run, hands-free. Renders the
 * `useVoiceSession` surface: a prominent 3-state conversation indicator
 * (聆听中 / 思考中 / 说话中) once the session is live, the connection status before
 * that, the player's own recognized-speech subtitle (你：…), the AI botanist's
 * streamed reply (植物学家：…), a bounded error line, and an end-call control.
 * There is NO push-to-talk — the mic streams continuously and the botanist
 * greets first; the player just talks. Dark-only, CSS-only animation.
 */
function VoicePanelImpl({ manualData, gameState, gameId }: VoicePanelProps) {
  const {
    status,
    conversationPhase,
    aiText,
    playerTranscript,
    isAiSpeaking,
    error,
    endSession,
    sendText,
  } = useVoiceSession({ manualData, gameState, gameId })

  const isLive = status === 'ready'
  const indicatorLabel = isLive ? PHASE_LABEL[conversationPhase] : STATUS_LABEL[status]

  return (
    <section className={styles.panel} aria-label="AI 植物学家语音">
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
          <span className={styles.speaking} role="status" aria-label="植物学家正在说话">
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
          <span className={styles.transcriptLabel}>你：</span>
          {playerTranscript}
        </p>
      )}

      <div className={styles.reply} role="status" aria-live="polite">
        {aiText ? (
          <p className={styles.replyText} aria-label="植物学家说的话">
            <span className={styles.transcriptLabel}>植物学家：</span>
            {aiText}
          </p>
        ) : (
          <p className={styles.replyPlaceholder}>{placeholderFor(status, conversationPhase)}</p>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {/* Text fallback (FP1 A): type instead of speak — same botanist session. */}
      <TextPanel onSend={sendText} disabled={!isLive} />

      <div className={styles.footer}>
        <p className={styles.hint}>免提对话已开启，直接对植物学家说话即可，无需按键。</p>
        {isLive && (
          <button type="button" className={styles.endButton} onClick={endSession}>
            结束对话
          </button>
        )}
      </div>
    </section>
  )
}

/** Memoized so the ~60fps GamePage timer re-render does not re-render the panel. */
const VoicePanel = memo(VoicePanelImpl)
export default VoicePanel
