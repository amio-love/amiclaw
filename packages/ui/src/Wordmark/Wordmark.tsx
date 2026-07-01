import styles from './Wordmark.module.css'

interface WordmarkProps {
  /* `text` → the plain prose name (inherits surrounding type, so it drops into
     running copy). `lockup` → the AMIO Arcade brand mark. */
  variant?: 'text' | 'lockup'
  language?: 'en' | 'zh'
  className?: string
}

/* The single source for how the product name renders. Prose copy, titles and
   alt text use the `text` variant (`AMIO Arcade` / `AMIO 游乐场`); the TopNav
   brand link and any logo placement use the `lockup` variant. The two forms are
   never mixed — see DesignSystem.md §Brand → Product Name. */
export default function Wordmark({ variant = 'text', language = 'en', className }: WordmarkProps) {
  if (variant === 'lockup') {
    const classes = [styles.lockup, className].filter(Boolean).join(' ')
    return (
      <span className={classes} aria-label="AMIO Arcade">
        <span>AMIO</span>
        <span className={styles.arcade}>Arcade</span>
      </span>
    )
  }
  return <span className={className}>{language === 'zh' ? 'AMIO 游乐场' : 'AMIO Arcade'}</span>
}
