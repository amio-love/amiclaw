import { Link } from 'react-router-dom'
import { PlanetOrb } from '@amiclaw/ui'
import { useAuth } from '@/hooks/useAuth'
import { useCompanion } from '@/hooks/useCompanion'
import { useCompanionProxyBeat } from './useCompanionProxyBeat'
import styles from './CompanionProxyBeat.module.css'

/**
 * CompanionProxyBeat — the 甲-side事后透明 line (spec §Variant 3, mockup 屏 C).
 *
 * Mounted once in PlatformLayout so it is route-independent across the lobby's
 * platform pages and never double-mounts. It self-gates on a signed-in player
 * WITH a companion (the companion-presence precondition for 代言), fires the V1
 * background trigger once per session, and renders a single dismissible line
 * when the companion actually left a public message — never stacked, never
 * interrupting. The 「→ 看看我说了什么」 link routes to the community feed.
 */
export default function CompanionProxyBeat() {
  const auth = useAuth()
  const { state } = useCompanion(auth.status === 'authed')
  const hasCompanion = state.status === 'exists'
  const { line, dismiss } = useCompanionProxyBeat(auth.status === 'authed' && hasCompanion)

  if (!line) return null

  return (
    <div className={styles.beat} role="status" aria-label="伙伴代言提示">
      <PlanetOrb variant="avatar" size={30} ariaHidden />
      <div className={styles.text}>
        {line.text}
        <Link to={line.href} className={styles.cta} onClick={dismiss}>
          → 看看我说了什么
        </Link>
      </div>
      <button type="button" className={styles.close} onClick={dismiss} aria-label="关闭">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M4 4 L12 12 M12 4 L4 12"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
