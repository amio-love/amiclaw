import type { ReactNode } from 'react'
import styles from './StatPill.module.css'

interface StatPillProps {
  value: ReactNode
  label: string
  className?: string
}

/* Floating stat card for the hero planet stage. The parent supplies
   absolute positioning via `className`. */
export default function StatPill({ value, label, className }: StatPillProps) {
  const classes = [styles.pill, className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
    </div>
  )
}
