import { useId, useState, type ReactNode } from 'react'
import styles from './Disclosure.module.css'

interface DisclosureProps {
  /**
   * Accessible name for the ⓘ toggle (e.g.「连续打卡说明」). The default UI
   * states only the emotional fact; the operational caveats (UTC day boundary,
   * device boundary, longest streak) live inside, revealed on demand. Honesty
   * content is never deleted — it relocates here (rc §3 progressive disclosure).
   */
  label: string
  /** The disclosed detail — the relocated operational caveats. */
  children: ReactNode
}

function InfoGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="4.7" r="0.95" fill="currentColor" />
      <path d="M8 7 V12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Disclosure — the platform's shared progressive-disclosure affordance. A small
 * ⓘ toggle that reveals a panel of relocated operational detail. Minimal-state
 * React (open/closed), CSS-only reveal, dark-only, ≥44px tap target via padding
 * while the glyph stays visually compact.
 */
export default function Disclosure({ label, children }: DisclosureProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  // `display: contents` — the toggle + panel participate directly in the
  // consumer's layout, so the panel breaks full-width in both flex-row and
  // block containers (see Disclosure.module.css).
  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
      >
        <InfoGlyph />
      </button>
      {open && (
        <span id={panelId} role="note" className={styles.panel}>
          {children}
        </span>
      )}
    </span>
  )
}
