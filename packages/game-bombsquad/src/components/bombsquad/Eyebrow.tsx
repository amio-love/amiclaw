import type { ReactNode } from 'react'
import styles from './Eyebrow.module.css'

interface EyebrowProps {
  children: ReactNode
  /* Leading pulsing status dot. */
  dot?: boolean
  /* Drives both the text and the dot color. */
  color?: string
  className?: string
}

/* BombSquad eyebrow — small uppercase glass-pill label, optionally
   led by a pulsing status dot (design_handoff_bombsquad README
   §5.3 / §5.5). */
export default function Eyebrow({
  children,
  dot = false,
  color = 'var(--y)',
  className,
}: EyebrowProps) {
  const classes = [styles.eyebrow, className].filter(Boolean).join(' ')
  return (
    <span className={classes} style={{ color }}>
      {dot && (
        <span className={styles.dot} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      )}
      {children}
    </span>
  )
}
