import type { ReactNode } from 'react'
import styles from './Chip.module.css'

interface ChipProps {
  variant: 'cyan' | 'soon' | 'dev' | 'live' | 'brand'
  children: ReactNode
}

/* Small pill badge — brand (yellow) AI-tool chip, cyan featured-art chip,
   or a game status badge (soon / dev / live). */
export default function Chip({ variant, children }: ChipProps) {
  return <span className={`${styles.chip} ${styles[variant]}`}>{children}</span>
}
