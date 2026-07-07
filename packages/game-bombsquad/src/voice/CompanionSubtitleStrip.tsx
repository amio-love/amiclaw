import styles from './CompanionSubtitleStrip.module.css'

/**
 * In-game companion subtitle strip (companion-presence-design §字幕条).
 *
 * A narrow banner at the top of the game screen showing the sentence the
 * companion is currently speaking during a mode② voice session. It updates
 * live with the streamed reply and disappears the moment the voice ends — no
 * dwell time (that is the dock bubble's behaviour, on non-game pages). Top
 * placement is deliberate: the bomb-module interaction area owns the bottom.
 *
 * Presentation only — GamePage feeds it the live utterance reported by
 * VoicePanel's `onUtterance`; it renders nothing when there is no active
 * speech. Proactive beats stay frozen during the run (§游戏内共存规则): the
 * only text that can appear here is the collaboration channel's own reply.
 */
export default function CompanionSubtitleStrip({ text }: { text: string }) {
  if (!text) return null
  return (
    <div className={styles.strip} role="status" aria-label="伙伴字幕">
      <span className={styles.text}>{text}</span>
    </div>
  )
}
