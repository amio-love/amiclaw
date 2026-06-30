import { Link } from 'react-router-dom'
import { GlassCard } from '@amiclaw/ui'
import type { ProfileClaimView } from '@shared/companion-types'
import { formatOccurredAt } from '@/lib/companion-format'
import styles from './ClaimCard.module.css'

interface ClaimCardProps {
  claim: ProfileClaimView
  onCorrect: (claim: ProfileClaimView) => void
  onDelete: (claim: ProfileClaimView) => void
}

/* One understanding-layer claim with its evidence chain. Every claim links back
   to the real memories it came from — "每条理解都能点回那一页回忆" — so each
   evidence row is a link into the album focused on that episode. The player can
   correct or delete the claim. */
export default function ClaimCard({ claim, onCorrect, onDelete }: ClaimCardProps) {
  return (
    <GlassCard radius="xl" as="article" className={styles.card}>
      <span className={styles.dimension}>{claim.dimension}</span>
      <p className={styles.claim}>{claim.claim}</p>

      <div className={styles.evidence}>
        <span className={styles.evidenceLabel}>依据这些回忆</span>
        <ul className={styles.evidenceList}>
          {claim.evidence.map((evidence) => (
            <li key={evidence.episode_id}>
              <Link
                to={`/me/memories?focus=${encodeURIComponent(evidence.episode_id)}`}
                className={styles.evidenceLink}
              >
                <span className={styles.evidenceTitle}>{evidence.title}</span>
                <span className={styles.evidenceDate}>
                  {formatOccurredAt(evidence.occurred_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={() => onCorrect(claim)}>
          纠正
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.delete}`}
          onClick={() => onDelete(claim)}
        >
          删除
        </button>
      </div>
    </GlassCard>
  )
}
