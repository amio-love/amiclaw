import styles from './BombSquadWordmark.module.css'

interface BombSquadWordmarkProps {
  /* `lobby` rides the responsive 44 → 56 → clamp(46px,6.5vw,72px) → 84px ramp
     (the BombSquad lobby title). `hero` renders at the large (~84px) end for
     the homepage feature panel. Color and glow are fixed; only size scales. */
  size?: 'hero' | 'lobby'
  className?: string
}

/* The single source for the BOMBSQUAD wordmark: the word rendered inline, the
   front half `BOMB` white and the back half `SQUAD` brand-yellow with a glow.
   One treatment everywhere — never cyan, never monospace at display size. See
   DesignSystem.md §Brand → BombSquad Wordmark. */
export default function BombSquadWordmark({ size = 'lobby', className }: BombSquadWordmarkProps) {
  const classes = [styles.wordmark, styles[size], className].filter(Boolean).join(' ')
  return (
    <span className={classes}>
      BOMB<span className={styles.accent}>SQUAD</span>
    </span>
  )
}
