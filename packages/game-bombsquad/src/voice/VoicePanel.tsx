import { memo, useCallback, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { GameState, ManualData } from '@amiclaw/platform-ai/contract'
import { useVoiceSession } from './useVoiceSession'
import type { VoiceStatus } from './voice-session-protocol'
import styles from './VoicePanel.module.css'

interface VoicePanelProps {
  /** Per-run manual payload (`null` while the manual is still loading). */
  manualData: ManualData | null
  /** Game state driving the manual-subset selection for this module. */
  gameState: GameState
  /** Platform game id; defaults to `'bombsquad'` inside the hook. */
  gameId?: string
}

/**
 * In-game voice panel for the BombSquad daily run (mode②). Renders the
 * `useVoiceSession` surface: a connection/turn status indicator, the AI's
 * streamed text reply, an "AI is speaking" cue, a bounded error line, and a
 * push-to-talk control (hold to talk). Presentation only — it reads hook state
 * and drives the hook's `startTalking` / `stopTalking`; it never touches game
 * logic. Dark-only, CSS-only animation (Atlas design system).
 */

/** User-facing connection/turn status copy. Chinese — daily players are the reader. */
const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: '准备中',
  connecting: '连接中',
  ready: '已连接',
  'in-turn': '通话中',
  error: '连接出错',
  closed: '已结束',
}

function VoicePanelImpl({ manualData, gameState, gameId }: VoicePanelProps) {
  const { status, aiText, isAiSpeaking, error, startTalking, stopTalking } = useVoiceSession({
    manualData,
    gameState,
    gameId,
  })

  // Whether the player is currently holding the push-to-talk control. Tracked in
  // state (not derived from `status`) because `in-turn` covers BOTH the player
  // speaking and the AI responding — only an explicit hold should read as "live
  // mic". Drives the button label + the listening pulse.
  const [holding, setHolding] = useState(false)

  // Push-to-talk: hold to talk. Pointer capture binds the release to this
  // element even if the finger drifts off it, so a pointerup always pairs with
  // its pointerdown. The hook guards every transition (no-op unless ready /
  // already talking), so these handlers can fire unconditionally.
  const beginTalk = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* pointer capture unsupported (e.g. jsdom) — the release path still fires */
      }
      setHolding(true)
      startTalking()
    },
    [startTalking]
  )

  const endTalk = useCallback(() => {
    setHolding((wasHolding) => {
      if (wasHolding) stopTalking()
      return false
    })
  }, [stopTalking])

  // Keyboard hold-to-talk (Space / Enter) for non-pointer users. `repeat` guards
  // the key auto-repeat so a held key starts capture exactly once.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      if (e.repeat) return
      e.preventDefault()
      setHolding(true)
      startTalking()
    },
    [startTalking]
  )

  const onKeyUp = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      endTalk()
    },
    [endTalk]
  )

  // Enabled when the session can take a turn (ready) or one is already in the
  // player's hand (holding). While the AI responds after release — in-turn but
  // not holding — the control is disabled, which also blocks starting a second
  // overlapping turn.
  const talkEnabled = status === 'ready' || holding
  const talkLabel = holding ? '松开结束' : '按住说话'

  const replyPlaceholder =
    status === 'ready' || status === 'in-turn' ? '按住下面的按钮，对 AI 说话' : '正在接通 AI 语音…'

  return (
    <section className={styles.panel} aria-label="AI 语音伙伴">
      <div className={styles.header}>
        <span className={styles.status}>
          <span className={styles.statusDot} data-status={status} aria-hidden="true" />
          <span className={styles.statusText} role="status">
            {STATUS_LABEL[status]}
          </span>
        </span>
        {isAiSpeaking && (
          <span className={styles.speaking} role="status">
            AI 正在回应
            <span className={styles.speakingDots} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
        )}
      </div>

      <div className={styles.reply} role="log" aria-live="polite">
        {aiText ? (
          <p className={styles.replyText}>{aiText}</p>
        ) : (
          <p className={styles.replyPlaceholder}>{replyPlaceholder}</p>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className={`${styles.talkBtn} ${holding ? styles.talkBtnActive : ''}`}
        onPointerDown={beginTalk}
        onPointerUp={endTalk}
        onPointerCancel={endTalk}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        disabled={!talkEnabled}
        aria-pressed={holding}
        aria-label={talkLabel}
      >
        <span className={styles.talkBtnIcon} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11 a7 7 0 0 0 14 0 M12 18 V21 M9 21 H15" strokeLinecap="round" />
          </svg>
        </span>
        {talkLabel}
      </button>
    </section>
  )
}

/**
 * Memoized so the ~60fps GamePage timer re-render does not re-render the panel:
 * with the stable, memoized `manualData` / `gameState` props from GamePage it
 * only re-renders on its own hook-state changes.
 */
const VoicePanel = memo(VoicePanelImpl)
export default VoicePanel
