import styles from './Wordmark.module.css'

interface WordmarkProps {
  /* `text` → the plain prose name `AmiClaw` (inherits surrounding type, so it
     drops into running copy). `lockup` → the `AMIO·claw` brand mark. */
  variant?: 'text' | 'lockup'
  className?: string
}

/* The single source for how the product name renders. Prose copy, titles and
   alt text use the `text` variant (`AmiClaw`); the TopNav brand link and any
   logo placement use the `lockup` variant (`AMIO·claw`). The two forms are
   never mixed — see DesignSystem.md §Brand → Product Name. */
export default function Wordmark({ variant = 'text', className }: WordmarkProps) {
  if (variant === 'lockup') {
    const classes = [styles.lockup, className].filter(Boolean).join(' ')
    return (
      <span className={classes}>
        AMIO<span className={styles.dot}>·</span>claw
      </span>
    )
  }
  return <span className={className}>AmiClaw</span>
}
