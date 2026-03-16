import type { SceneInfo } from '@shared/manual-schema'
import styles from './SceneInfoBar.module.css'

interface SceneInfoBarProps {
  sceneInfo: SceneInfo
}

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
      {sceneInfo.indicators.map(ind => (
        <span
          key={ind.label}
          className={`${styles.indicator} ${ind.lit ? styles.lit : styles.unlit}`}
          title={ind.lit ? `${ind.label} (lit)` : `${ind.label} (unlit)`}
        >
          {ind.label}
        </span>
      ))}
    </div>
  )
}
