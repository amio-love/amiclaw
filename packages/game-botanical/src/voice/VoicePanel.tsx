import { memo } from 'react'
import {
  useGameVoiceSession,
  type GameVoiceManualData,
  type GameVoiceState,
} from '@shared/voice/use-game-voice-session'
import type { ConversationPhase, VoiceStatus } from '@shared/voice/voice-session-protocol'
import { BOTANICAL_VOICE_GUARDS } from './botanical-voice-context'
import TextPanel from './TextPanel'
import styles from './VoicePanel.module.css'

interface VoicePanelProps {
  /** Per-run manual payload (`null` while the manual is still loading). */
  manualData: GameVoiceManualData | null
  /** Live game state driving the manual-subset selection for this turn. */
  gameState: GameVoiceState
  /** Platform game id — `'botanical-garden'` (companion) or `'demo-mock'` (dev). */
  gameId: string
}

/** The 3-state conversation phase copy (shown while the session is live). */
const PHASE_LABEL: Record<ConversationPhase, string> = {
  listening: '聆听中',
  thinking: '思考中',
  speaking: '说话中',
}

/** Connection-status copy while connecting (before the live phase). */
const STATUS_LABEL: Partial<Record<VoiceStatus, string>> = {
  idle: '准备中',
  connecting: '连接中',
  error: '连接出错',
  closed: '已结束',
}

function placeholderFor(status: VoiceStatus, phase: ConversationPhase): string {
  if (status === 'ready') {
    if (phase === 'thinking') return '植物学家正在思考…'
    if (phase === 'speaking') return '植物学家正在回应…'
    return '开口说话，植物学家会即时回应'
  }
  return '正在接通植物学家…'
}

/**
 * In-game voice panel for the Botanical run — the account companion acting as the
 * botanist, over the shared `@shared/voice/use-game-voice-session` hook (the same
 * client BombSquad / Shadow-Chase use), connected same-origin to the platform
 * Worker with `gameId:'botanical-garden'`. Hands-free once started; the mic opens
 * behind the「开始对话」user gesture (getUserMedia needs one), then the botanist
 * greets first. A typed-input fallback (TextPanel → `sendText`) rides the same
 * session. Dark-only, CSS-only animation.
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
    openSession,
  } = useGameVoiceSession({
    manualData,
    gameState,
    gameId,
    guards: BOTANICAL_VOICE_GUARDS,
    sessionNamePrefix: 'botanical',
    // The mic opens on the server's `created`; getUserMedia needs a user gesture,
    // so we connect on the「开始对话」click rather than auto-connecting on mount.
    autoConnect: false,
  })

  const isLive = status === 'ready'
  const notStarted = status === 'idle' || status === 'closed' || status === 'error'
  const indicatorLabel = isLive
    ? PHASE_LABEL[conversationPhase]
    : (STATUS_LABEL[status] ?? '准备中')

  if (notStarted) {
    return (
      <section className={styles.panel} aria-label="AI 植物学家语音">
        <button type="button" className={styles.startButton} onClick={() => openSession()}>
          {status === 'idle' ? '开始对话' : '重新连接'}
        </button>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p className={styles.hint}>
          点「开始对话」授权麦克风，植物学家会先打招呼；随后可直接说话或打字。
        </p>
      </section>
    )
  }

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

      {/* Text fallback (platform text-turn): type instead of speak — same session. */}
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
