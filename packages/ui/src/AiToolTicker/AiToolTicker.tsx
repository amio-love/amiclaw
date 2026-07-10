import type { CSSProperties } from 'react'
import { AI_TOOLS } from '../AiToolList'
import styles from './AiToolTicker.module.css'

/* Seconds each tool name dwells before flipping to the next. The CSS keyframe
   cadence (AiToolTicker.module.css) is calibrated for the current AI_TOOLS
   count — if the set size changes materially, retune the keyframe stops. */
const BEAT_SECONDS = 1.6

/* First grapheme of a tool name — the monogram letter. */
function monogram(name: string): string {
  return Array.from(name)[0] ?? '?'
}

/* Inline vertical ticker — the supported voice-AI tool name flips up/down in
   place inside a sentence (e.g. 「带上你的 [Claude↕]，来玩一局」). One small
   monogram-in-orb glyph rides beside each name. CSS-only motion; pauses on
   hover / focus; under prefers-reduced-motion it holds the first tool static.
   Names come from the single AI_TOOLS source — no re-declared list. */
export default function AiToolTicker({ className }: { className?: string }) {
  const classes = [styles.ticker, className].filter(Boolean).join(' ')
  const cycleStyle = { '--tick-cycle': `${AI_TOOLS.length * BEAT_SECONDS}s` } as CSSProperties
  // Screen readers get the whole set once, not the flipping names.
  const label = `支持的语音 AI：${AI_TOOLS.join('、')}`

  return (
    <span className={classes} style={cycleStyle} tabIndex={0} role="img" aria-label={label}>
      {AI_TOOLS.map((name, index) => (
        <span
          key={name}
          className={styles.item}
          style={{ '--tick-delay': `${index * BEAT_SECONDS}s` } as CSSProperties}
          aria-hidden="true"
        >
          <svg className={styles.orb} viewBox="0 0 20 20" width="1em" height="1em">
            <circle cx="10" cy="10" r="9" className={styles.orbRing} />
            <text x="10" y="10" className={styles.orbLetter}>
              {monogram(name)}
            </text>
          </svg>
          <span className={styles.name}>{name}</span>
        </span>
      ))}
      {/* First tool, statically shown so the ticker reserves its width and the
          reduced-motion fallback has content. */}
      <span className={styles.spacer} aria-hidden="true">
        <svg className={styles.orb} viewBox="0 0 20 20" width="1em" height="1em">
          <circle cx="10" cy="10" r="9" className={styles.orbRing} />
          <text x="10" y="10" className={styles.orbLetter}>
            {monogram(AI_TOOLS[0])}
          </text>
        </svg>
        <span className={styles.name}>{AI_TOOLS[0]}</span>
      </span>
    </span>
  )
}
