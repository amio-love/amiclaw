import type { ReactNode } from 'react'
import styles from './ConicAvatar.module.css'

interface ConicAvatarProps {
  size: number
  letter?: string
  spin?: boolean
  dim?: boolean
  children?: ReactNode
  ariaHidden?: boolean
}

/* Conic-gradient ring with a black inner circle. Renders `children`
   when given, otherwise `letter`. Padding scales with size. */
export default function ConicAvatar({
  size,
  letter,
  spin = false,
  dim = false,
  children,
  ariaHidden = false,
}: ConicAvatarProps) {
  const pad = size <= 40 ? 2 : size <= 72 ? 3 : 4
  const classes = [styles.ring, dim && styles.dim, spin && styles.spin].filter(Boolean).join(' ')
  return (
    <div
      className={classes}
      style={{ width: size, height: size, padding: pad }}
      aria-hidden={ariaHidden || undefined}
    >
      <div className={styles.inner} style={{ fontSize: Math.round(size * 0.36) }}>
        {children ?? letter}
      </div>
    </div>
  )
}
