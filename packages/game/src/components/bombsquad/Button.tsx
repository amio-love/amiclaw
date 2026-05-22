import type { ReactNode } from 'react'
import styles from './Button.module.css'

interface ButtonProps {
  variant: 'primary' | 'ghost'
  /* Primary fill color — yellow (default), green, or rose. Ignored
     for the ghost variant. */
  accent?: 'yellow' | 'green' | 'rose'
  full?: boolean
  /* Yellow hover halo + 1px lift (primary only). */
  glow?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
}

/* BombSquad pill button. Distinct from ui/Button — the BombSquad
   spec adds green / rose primary accents, a full-width mode, and
   uses the game's 14/22 padding with a yellow hover-glow
   (design_handoff_bombsquad README §5.5). */
export default function Button({
  variant,
  accent = 'yellow',
  full = false,
  glow = true,
  type = 'button',
  disabled = false,
  onClick,
  className,
  children,
}: ButtonProps) {
  const isPrimary = variant === 'primary'
  const classes = [
    styles.button,
    styles[variant],
    full && styles.full,
    isPrimary && glow && styles.glow,
    isPrimary && accent === 'green' && styles.accentGreen,
    isPrimary && accent === 'rose' && styles.accentRose,
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
