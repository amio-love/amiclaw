import styles from './Timer.module.css'
import { useStopwatchLoop } from '@/hooks/useStopwatchLoop'

interface TimerProps {
  display: string // MM:SS — elapsed time, counting up (a stopwatch)
  isRunning: boolean
}

export default function Timer({ display, isRunning }: TimerProps) {
  useStopwatchLoop(isRunning)
  return (
    <div
      className={`${styles.timer} ${isRunning ? styles.running : ''}`}
      role="timer"
      aria-label={`用时：${display}`}
    >
      {display}
    </div>
  )
}
