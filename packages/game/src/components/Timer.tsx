import styles from './Timer.module.css'

interface TimerProps {
  display: string     // MM:SS from useTimer
  isRunning: boolean
}

export default function Timer({ display, isRunning }: TimerProps) {
  return (
    <div
      className={`${styles.timer} ${isRunning ? styles.running : ''}`}
      role="timer"
      aria-label={`Elapsed time: ${display}`}
    >
      {display}
    </div>
  )
}
