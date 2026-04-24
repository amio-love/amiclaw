import styles from './ProgressBar.module.css'

interface ProgressBarProps {
  total: number // always 4 for MVP
  completed: number
  current: number // index of active module
}

export default function ProgressBar({ total, completed, current }: ProgressBarProps) {
  return (
    <div
      className={styles.bar}
      role="progressbar"
      aria-valuenow={completed}
      aria-valuemax={total}
      aria-label={`已完成 ${completed} / ${total} 个模块`}
    >
      {Array.from({ length: total }, (_, i) => {
        let segClass = styles.segment
        if (i < completed) segClass += ` ${styles.filled}`
        else if (i === current) segClass += ` ${styles.active}`
        return (
          <span
            key={i}
            className={segClass}
            aria-label={`模块 ${i + 1}：${i < completed ? '已完成' : i === current ? '进行中' : '待拆'}`}
          />
        )
      })}
    </div>
  )
}
