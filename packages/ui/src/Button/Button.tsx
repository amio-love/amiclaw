import type { ReactNode } from 'react'
import styles from './Button.module.css'

interface ButtonProps {
  variant: 'primary' | 'ghost'
  size?: 'md' | 'sm'
  /* Full-width block button (own 16/22 padding — supersedes `size`). */
  full?: boolean
  /* Primary fill color — yellow (default), green, or rose. Ignored for the
     ghost variant. green / rose are the BombSquad success / near-miss accents. */
  accent?: 'yellow' | 'green' | 'rose'
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}

/* Pill button — primary (yellow / green / rose fill) or ghost (glass outline),
   with an optional full-width mode. One shared button for the platform and
   every game (absorbs the former BombSquad Button). */
export default function Button({
  variant,
  size = 'md',
  full = false,
  accent = 'yellow',
  type = 'button',
  onClick,
  disabled = false,
  className,
  children,
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    // full defines its own padding, so it supersedes the size class.
    full ? styles.full : styles[size],
    variant === 'primary' && accent === 'green' && styles.accentGreen,
    variant === 'primary' && accent === 'rose' && styles.accentRose,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={classes} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
