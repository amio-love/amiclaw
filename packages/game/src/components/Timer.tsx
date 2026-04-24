import styles from './Timer.module.css'

interface TimerProps {
  display: string // MM:SS from useTimer
  isRunning: boolean
}

export default function Timer({ display, isRunning }: TimerProps) {
  return (
    <div
      className={`${styles.timer} ${isRunning ? styles.running : ''}`}
      role="timer"
      aria-label={`已用时间：${display}`}
    >
      {display}
    </div>
  )
}
