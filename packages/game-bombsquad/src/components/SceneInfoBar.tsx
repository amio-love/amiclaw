import type { SceneInfo } from '@shared/manual-schema'
import styles from './SceneInfoBar.module.css'

interface SceneInfoBarProps {
  sceneInfo: SceneInfo
  /** First-run only: highlight the bar and show a one-time "read this to your AI" hint. */
  showNudge?: boolean
  /** Called when the player taps the hint's dismiss control. */
  onDismissNudge?: () => void
}

/**
 * Permanent HUD row showing the puzzle-global variables the player has to read
 * to their AI (scene tongue-twister phrase, battery count, and indicators with
 * lit/unlit state). Always visible — the earlier mobile collapse hid the
 * single most important piece of onboarding information behind an unlabelled
 * chevron.
 *
 * On a first-timer's first module, `showNudge` adds a dismissible hint above
 * the bar and a brief highlight pulse, prompting them to read this row to the
 * AI before diving into the puzzle. The hint never blocks interaction — its
 * container is click-through and only the dismiss control is interactive.
 */
export default function SceneInfoBar({
  sceneInfo,
  showNudge = false,
  onDismissNudge,
}: SceneInfoBarProps) {
  return (
    <div className={styles.wrap}>
      {showNudge && (
        <div className={styles.nudge} role="status">
          <span className={styles.nudgeText}>开局先把这一行读给 AI</span>
          <button
            type="button"
            className={styles.nudgeDismiss}
            onClick={onDismissNudge}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}
      <div className={`${styles.bar} ${showNudge ? styles.barNudged : ''}`} aria-label="场景信息栏">
        <span className={styles.field}>
          <span className={styles.label}>暗号：</span>
          <span className={styles.value}>{sceneInfo.sceneTongueTwister}</span>
        </span>
        <span className={styles.field}>
          <span className={styles.label}>电池：</span>
          <span className={styles.value}>{sceneInfo.batteryCount}</span>
        </span>
        <span className={`${styles.field} ${styles.indicators}`}>
          <span className={styles.label}>指示灯：</span>
          {sceneInfo.indicators.length > 0 ? (
            sceneInfo.indicators.map((ind, i) => (
              <span
                key={`${ind.label}-${i}`}
                className={`${styles.indicator} ${ind.lit ? styles.lit : styles.unlit}`}
                title={ind.lit ? `${ind.label}（亮）` : `${ind.label}（灭）`}
              >
                {ind.label}
              </span>
            ))
          ) : (
            <span className={styles.value}>无</span>
          )}
        </span>
      </div>
    </div>
  )
}
