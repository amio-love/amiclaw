import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './IconButton.module.css'

interface IconButtonProps {
  /* Accessible name — required, since the button is icon-only. */
  label: string
  children: ReactNode
  /* Navigation target. `to` → in-app router link; `href` → full-page anchor
     (cross-SPA / platform exits). Omit both for an `onClick` button. */
  to?: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  /* `circle` (default) → glass-bordered round chrome; `bare` → chrome-free,
     just the ≥44px hit area (for text-glyph arrows that carry their own look). */
  variant?: 'circle' | 'bare'
  className?: string
}

/* Icon-only affordance with a guaranteed ≥44px touch target (DesignSystem.md
   §Layout). Renders a router Link, a plain anchor, or a button depending on the
   navigation props. One shared source for the back / exit / step affordances
   every game used to hand-roll. */
export default function IconButton({
  label,
  children,
  to,
  href,
  onClick,
  disabled = false,
  variant = 'circle',
  className,
}: IconButtonProps) {
  const classes = [styles.iconButton, styles[variant], className].filter(Boolean).join(' ')

  if (to !== undefined) {
    return (
      <Link to={to} className={classes} aria-label={label}>
        {children}
      </Link>
    )
  }
  if (href !== undefined) {
    return (
      <a href={href} className={classes} aria-label={label}>
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
