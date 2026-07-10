import type { ReactNode } from 'react'
import styles from './Chip.module.css'

interface ChipProps {
  variant: 'soon' | 'dev' | 'live' | 'brand' | 'verified' | 'untested'
  children: ReactNode
}

/* Small pill badge — brand (yellow) AI-tool chip, a game status badge
   (soon / dev / live), or a verification badge (verified / untested). */
export default function Chip({ variant, children }: ChipProps) {
  return <span className={`${styles.chip} ${styles[variant]}`}>{children}</span>
}
