import type { SceneInfo } from '@shared/manual-schema'
import styles from './SceneInfoBar.module.css'

interface SceneInfoBarProps {
  sceneInfo: SceneInfo
}

/**
 * Permanent HUD row showing the puzzle-global variables the player has to read
 * to their AI (serial number, battery count, and indicators with lit/unlit
 * state). Always visible — the earlier mobile collapse hid the single most
 * important piece of onboarding information behind an unlabelled chevron.
 */
export default function SceneInfoBar({ sceneInfo }: SceneInfoBarProps) {
  return (
    <div className={styles.bar} aria-label="Scene information panel">
      <span className={styles.field}>
        <span className={styles.label}>SN:</span>
        <span className={styles.value}>{sceneInfo.serialNumber}</span>
      </span>
      <span className={styles.field}>
        <span className={styles.label}>BATT:</span>
        <span className={styles.value}>{sceneInfo.batteryCount}</span>
      </span>
      {sceneInfo.indicators.map((ind, i) => (
        <span
          key={`${ind.label}-${i}`}
          className={`${styles.indicator} ${ind.lit ? styles.lit : styles.unlit}`}
          title={ind.lit ? `${ind.label} (lit)` : `${ind.label} (unlit)`}
        >
          {ind.label}
        </span>
      ))}
    </div>
  )
}
