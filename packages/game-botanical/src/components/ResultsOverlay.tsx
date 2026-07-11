import { Button, GlassCard } from '@amiclaw/ui'
import styles from './ResultsOverlay.module.css'
import type { PlantView, RunStatus } from '@/game/useGardenSession'
import { formatClock } from '@/game/format'
import { GROWTH_LABEL, HEALTH_LABEL, speciesLabel } from '@/game/visual-map'

interface ResultsOverlayProps {
  status: RunStatus
  elapsedMs: number
  ops: number
  plants: PlantView[]
  onReplay: () => void
}

/* Win/lose results, shown as an overlay over the frozen garden. Time + ops +
   the final state of every plant, with a prominent full-reset 再玩一次. */
export default function ResultsOverlay({
  status,
  elapsedMs,
  ops,
  plants,
  onReplay,
}: ResultsOverlayProps) {
  if (status === 'playing') return null
  const won = status === 'won'
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="result-title">
      <GlassCard radius="2xl" className={styles.card}>
        <h2 id="result-title" className={`${styles.title} ${won ? styles.win : styles.lose}`}>
          {won ? '养护成功 🌸' : '养护失败 🥀'}
        </h2>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <b>{formatClock(elapsedMs)}</b>
            <span>用时</span>
          </div>
          <div className={styles.stat}>
            <b>{ops}</b>
            <span>操作数</span>
          </div>
        </div>
        <ul className={styles.final}>
          {[...plants]
            .sort((a, b) => a.potPosition - b.potPosition)
            .map((plant) => (
              <li key={plant.id}>
                <span className={styles.finalName}>{speciesLabel(plant.species)}</span>
                <span className={styles.finalState}>
                  {plant.health === 'dead'
                    ? '枯株'
                    : `${HEALTH_LABEL[plant.health]} · ${GROWTH_LABEL[plant.growthStage]}`}
                </span>
              </li>
            ))}
        </ul>
        <Button variant="primary" className={styles.replay} onClick={onReplay}>
          再玩一次
        </Button>
      </GlassCard>
    </div>
  )
}
