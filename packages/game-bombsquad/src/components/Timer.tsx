import styles from './Timer.module.css'
import { useStopwatchLoop } from '@/hooks/useStopwatchLoop'

interface TimerProps {
  display: string // MM:SS — remaining time, counting down
  isRunning: boolean
  /** Daily-challenge low-time warning — turns the timer red below 60s left. */
  lowTime?: boolean
}

export default function Timer({ display, isRunning, lowTime = false }: TimerProps) {
  useStopwatchLoop(isRunning)
  return (
    <div
      className={`${styles.timer} ${isRunning ? styles.running : ''} ${
        lowTime ? styles.lowTime : ''
      }`}
      role="timer"
      aria-label={`剩余时间：${display}`}
    >
      {display}
    </div>
  )
}
