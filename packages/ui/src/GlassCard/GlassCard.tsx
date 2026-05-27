import type { ReactNode } from 'react'
import styles from './GlassCard.module.css'

interface GlassCardProps {
  radius?: 'lg' | 'xl' | '2xl' | '3xl'
  as?: 'div' | 'article' | 'section'
  interactive?: boolean
  className?: string
  children: ReactNode
}

const radiusClass: Record<NonNullable<GlassCardProps['radius']>, string> = {
  lg: styles.radiusLg,
  xl: styles.radiusXl,
  '2xl': styles.radius2xl,
  '3xl': styles.radius3xl,
}

/* Generic glass surface card. Bespoke cards (daily / featured) own
   their CSS directly and do not use this primitive. */
export default function GlassCard({
  radius = '2xl',
  as: Tag = 'div',
  interactive = false,
  className,
  children,
}: GlassCardProps) {
  const classes = [styles.card, radiusClass[radius], interactive && styles.interactive, className]
    .filter(Boolean)
    .join(' ')
  return <Tag className={classes}>{children}</Tag>
}
