import { Link } from 'react-router-dom'
import { GlassCard } from '@amiclaw/ui'
import { useAuth } from '@/hooks/useAuth'
import { companionSeedEnabled } from '@/lib/companion-seed'
import styles from './CompanionAccess.module.css'

/**
 * Access state for the mode②-only companion surfaces:
 *   - `loading` — the session read is still in flight; hold chrome only.
 *   - `gate`    — anonymous → show the login gate (companion needs an account).
 *   - `ready`   — signed in, OR the dev seed is on (a preview can be felt
 *                 without a live session / backend).
 */
export type CompanionAccessState = 'loading' | 'gate' | 'ready'

export function useCompanionAccess(): CompanionAccessState {
  const { status } = useAuth()
  if (companionSeedEnabled()) return 'ready'
  if (status === 'loading') return 'loading'
  if (status === 'authed') return 'ready'
  return 'gate'
}

/** The anonymous gate — companion is a signed-in (mode②) feature. Routes to
    the magic-link /login page; no fake companion is ever shown to anon. */
export function CompanionLoginGate() {
  return (
    <GlassCard radius="2xl" className={styles.gate}>
      <h3 className={styles.gateTitle}>登录后认识你的伙伴</h3>
      <p className={styles.gateText}>专属伙伴与你们一起积累的回忆，只在登录后属于你。</p>
      <Link to="/login" className={styles.gateCta}>
        登录
      </Link>
    </GlassCard>
  )
}
