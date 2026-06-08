import { useDailyCountdown } from '../useDailyCountdown'
import styles from './DailyCountdown.module.css'

interface DailyCountdownProps {
  /* `lg` → homepage daily card (~56px digits). `sm` → BombSquad lobby card
     (~26–32px digits). */
  size?: 'lg' | 'sm'
  className?: string
}

/* The single source for the daily-reset countdown: a mono `HH:MM:SS` digit row
   over a `时 分 秒` unit row, both fed by the shared `useDailyCountdown` hook
   (the one UTC-midnight reset clock). One treatment for both pre-game
   surfaces. The in-game stopwatch is a different element and is out of scope.
   See DesignSystem.md §Brand → Daily-Reset Countdown. */
export default function DailyCountdown({ size = 'lg', className }: DailyCountdownProps) {
  const [hours, minutes, seconds] = useDailyCountdown()
  const classes = [styles.countdown, styles[size], className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div className={styles.digits}>
        <span>{hours}</span>
        <span className={styles.sep}>:</span>
        <span>{minutes}</span>
        <span className={styles.sep}>:</span>
        <span>{seconds}</span>
      </div>
      <div className={styles.units}>
        <span>时</span>
        <span>分</span>
        <span>秒</span>
      </div>
    </div>
  )
}
