import { GlassCard } from '@amiclaw/ui'
import styles from './CompanionEmptyState.module.css'

interface CompanionEmptyStateProps {
  title: string
  text: string
  /** Optional play CTA — a plain anchor (it crosses into the BombSquad SPA). */
  ctaLabel?: string
  ctaHref?: string
}

/* Honest empty state for the companion surfaces — a plain prompt, never a
   「即将推出 / coming soon」placeholder (the data simply does not exist yet
   until the capture pipeline lands). Mirrors AccountPage's
   「还没有成绩，去玩一局」register. */
export default function CompanionEmptyState({
  title,
  text,
  ctaLabel,
  ctaHref,
}: CompanionEmptyStateProps) {
  return (
    <GlassCard radius="2xl" className={styles.card}>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.text}>{text}</p>
      {ctaLabel && ctaHref ? (
        <a className={styles.cta} href={ctaHref}>
          {ctaLabel}
        </a>
      ) : null}
    </GlassCard>
  )
}
