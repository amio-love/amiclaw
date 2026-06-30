import { useEffect, useRef } from 'react'
import { GlassCard } from '@amiclaw/ui'
import type { MemoryView } from '@shared/companion-types'
import { formatOccurredAt, gameLabel } from '@/lib/companion-format'
import styles from './MemoryCard.module.css'

interface MemoryCardProps {
  memory: MemoryView
  onRequestDelete: (memory: MemoryView) => void
  /** When true (the album is focused on this episode via an evidence link),
      the card highlights and scrolls into view. */
  focused?: boolean
}

/* One episode in the memory album — the companion's 1–3 sentence narrative of a
   run, with when + which game it happened, and a delete affordance. When a
   profile evidence link points here, the card is `focused`: highlighted and
   scrolled into view, so "每条理解都能点回那一页回忆" lands on the real episode. */
export default function MemoryCard({ memory, onRequestDelete, focused = false }: MemoryCardProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focused])

  return (
    <GlassCard
      radius="xl"
      as="article"
      className={[styles.card, focused && styles.focused].filter(Boolean).join(' ')}
    >
      <div ref={ref} className={styles.head}>
        <div className={styles.meta}>
          <span className={styles.date}>{formatOccurredAt(memory.occurred_at)}</span>
          <span className={styles.game}>{gameLabel(memory.game_id)}</span>
        </div>
        <button
          type="button"
          className={styles.delete}
          aria-label={`删除回忆「${memory.title}」`}
          onClick={() => onRequestDelete(memory)}
        >
          删除
        </button>
      </div>
      <h3 className={styles.title}>{memory.title}</h3>
      <p className={styles.narrative}>{memory.narrative}</p>
    </GlassCard>
  )
}
