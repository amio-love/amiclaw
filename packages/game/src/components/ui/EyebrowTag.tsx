import type { ReactNode } from 'react'
import styles from './EyebrowTag.module.css'

interface EyebrowTagProps {
  variant: 'section' | 'daily' | 'hero-pill'
  children: ReactNode
}

const variantClass: Record<EyebrowTagProps['variant'], string> = {
  section: styles.section,
  daily: styles.daily,
  'hero-pill': styles.heroPill,
}

/* Small uppercase label — plain section eyebrow, yellow-dot daily
   tag, or glass hero pill with a pulsing online dot. */
export default function EyebrowTag({ variant, children }: EyebrowTagProps) {
  return <span className={variantClass[variant]}>{children}</span>
}
