import type { BoardDay } from '@/lib/board-dates'
import styles from './BoardDateSwitcher.module.css'

interface BoardDateSwitcherProps {
  /** The navigable product days, today first (see getBoardDays). */
  days: BoardDay[]
  /** Index into `days` of the shown board (0 = today). */
  selectedIndex: number
  onSelect: (index: number) => void
}

/* Compact date switcher for the daily board — 前一天 / current-day label /
   后一天. Bounded to the `days` window: the oldest day disables 前一天, today
   disables 后一天. Icon-only glyph buttons carry accessible Chinese names. */
export default function BoardDateSwitcher({
  days,
  selectedIndex,
  onSelect,
}: BoardDateSwitcherProps) {
  const selected = days[selectedIndex]
  if (!selected) return null

  return (
    <div className={styles.switcher}>
      <button
        type="button"
        className={styles.arrow}
        aria-label="前一天"
        disabled={selectedIndex >= days.length - 1}
        onClick={() => onSelect(selectedIndex + 1)}
      >
        ‹
      </button>
      <span className={styles.label} aria-live="polite">
        {selected.label}
      </span>
      <button
        type="button"
        className={styles.arrow}
        aria-label="后一天"
        disabled={selectedIndex <= 0}
        onClick={() => onSelect(selectedIndex - 1)}
      >
        ›
      </button>
    </div>
  )
}
