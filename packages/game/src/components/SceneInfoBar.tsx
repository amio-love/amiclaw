import { useState } from 'react'
import type { SceneInfo } from '@shared/manual-schema'
import styles from './SceneInfoBar.module.css'

interface SceneInfoBarProps {
  sceneInfo: SceneInfo
}

export default function SceneInfoBar({ sceneInfo }: SceneInfoBarProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={styles.wrapper}>
      {/* Toggle only visible on mobile via CSS */}
      <button
        className={styles.toggle}
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-controls="scene-info-details"
      >
        <span className={styles.label}>SN:</span>
        <span className={styles.value}>{sceneInfo.serialNumber}</span>
        <span className={styles.chevron}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Details: always visible on desktop, toggle on mobile */}
      <div
        id="scene-info-details"
        className={`${styles.bar} ${expanded ? styles.open : ''}`}
        aria-label="Scene information panel"
      >
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
    </div>
  )
}
