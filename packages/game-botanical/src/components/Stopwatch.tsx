import styles from './Stopwatch.module.css'
import { formatClock } from '@/game/format'

interface StopwatchProps {
  elapsedMs: number
  running: boolean
}

/* Count-up stopwatch HUD (a score, not a deadline — faster ranks higher). */
export default function Stopwatch({ elapsedMs, running }: StopwatchProps) {
  const display = formatClock(elapsedMs)
  return (
    <div
      className={`${styles.timer} ${running ? styles.running : ''}`}
      role="timer"
      aria-label={`用时：${display}`}
    >
      {display}
    </div>
  )
}
