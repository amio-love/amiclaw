import { Link } from 'react-router-dom'
import IconButton from '../IconButton'
import styles from './BackLink.module.css'

interface BackLinkProps {
  /* Accessible name. For `inline`, also the visible label text. */
  label: string
  /* `to` → in-app router link; `href` → full-page anchor; else `onClick`. */
  to?: string
  href?: string
  onClick?: () => void
  /* `icon` (default) → back chevron in a ≥44px circle; `inline` → back chevron
     followed by the visible label, a ≥44px-tall text link. */
  variant?: 'icon' | 'inline'
  className?: string
}

/* The shared back chevron — one source for every back affordance. */
function BackChevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 4 L7 12 L15 20" />
    </svg>
  )
}

/* Back navigation affordance with the platform's standard chevron and a
   ≥44px touch target (DesignSystem.md §Layout). Absorbs the ~7 hand-rolled
   back buttons across the platform and games. */
export default function BackLink({
  label,
  to,
  href,
  onClick,
  variant = 'icon',
  className,
}: BackLinkProps) {
  if (variant === 'icon') {
    return (
      <IconButton label={label} to={to} href={href} onClick={onClick} className={className}>
        <BackChevron />
      </IconButton>
    )
  }

  const classes = [styles.inline, className].filter(Boolean).join(' ')
  const content = (
    <>
      <BackChevron />
      <span>{label}</span>
    </>
  )
  if (to !== undefined) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    )
  }
  if (href !== undefined) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    )
  }
  return (
    <button type="button" className={classes} onClick={onClick}>
      {content}
    </button>
  )
}
