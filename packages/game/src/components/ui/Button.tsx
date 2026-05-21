import type { ReactNode } from 'react'
import styles from './Button.module.css'

interface ButtonProps {
  variant: 'primary' | 'ghost'
  size?: 'md' | 'sm'
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}

/* Pill button — primary (yellow) or ghost (glass outline). */
export default function Button({
  variant,
  size = 'md',
  type = 'button',
  onClick,
  disabled = false,
  className,
  children,
}: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={classes} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
