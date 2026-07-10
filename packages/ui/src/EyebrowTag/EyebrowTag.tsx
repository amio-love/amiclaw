import type { ReactNode } from 'react'
import styles from './EyebrowTag.module.css'

interface EyebrowTagProps {
  variant: 'section' | 'daily' | 'hero-pill' | 'pill'
  className?: string
  children: ReactNode
}

const variantClass: Record<EyebrowTagProps['variant'], string> = {
  section: styles.section,
  daily: styles.daily,
  'hero-pill': styles.heroPill,
  pill: styles.pill,
}

/* Small uppercase label — plain section eyebrow, yellow-dot daily tag, glass
   hero pill with a pulsing online dot, or a glass `pill` with a yellow pulsing
   dot (absorbs the former BombSquad Eyebrow). */
export default function EyebrowTag({ variant, className, children }: EyebrowTagProps) {
  const classes = [variantClass[variant], className].filter(Boolean).join(' ')
  return <span className={classes}>{children}</span>
}
