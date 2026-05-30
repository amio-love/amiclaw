import { MAX_STRIKES } from '@/store/game-context'
import styles from './StrikeIndicator.module.css'

interface StrikeIndicatorProps {
  /** Cumulative wrong answers this daily run (0..MAX_STRIKES). */
  strikeCount: number
}

/**
 * Daily-challenge strike pips. Three pips; each wrong answer lights one in
 * neon-red. The first two lit pips are the visible warning the player is
 * meant to react to — the third strike detonates the bomb, so a steady 3/3
 * state is effectively never seen on screen.
 */
export default function StrikeIndicator({ strikeCount }: StrikeIndicatorProps) {
  const lit = Math.min(Math.max(strikeCount, 0), MAX_STRIKES)
  return (
    <div className={styles.indicator} role="status" aria-label={`失误 ${lit} / ${MAX_STRIKES}`}>
      {Array.from({ length: MAX_STRIKES }, (_, i) => {
        const isLit = i < lit
        return (
          <span
            key={i}
            data-testid="strike-pip"
            data-lit={isLit}
            className={`${styles.pip} ${isLit ? styles.lit : ''}`}
            aria-hidden="true"
          />
        )
      })}
    </div>
  )
}
