import { Link } from 'react-router-dom'
import { ConicAvatar, GlassCard } from '@amiclaw/ui'
import { useCompanion } from '@/hooks/useCompanion'
import { voiceName } from '@/lib/companion-voices'
import styles from './CompanionCard.module.css'

/* The companion entry on the AccountPage detail column.
     - no companion → an "认识你的伙伴" setup card routing to /me/companion.
     - exists → "你的伙伴 X" with the chosen voice, and links into the memory
       album + profile control surfaces.
   Rendered only for signed-in (or dev-seeded) visitors, so the read is always
   enabled. The read failing is non-blocking — a quiet note, never an error UI. */
export default function CompanionCard() {
  const { state } = useCompanion(true)

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>我的伙伴</h3>
      {state.status === 'loading' ? (
        <div className={styles.skeleton} aria-hidden="true" />
      ) : state.status === 'exists' ? (
        <GlassCard radius="2xl" className={styles.card}>
          <div className={styles.identity}>
            <ConicAvatar size={64} letter={state.companion.name.charAt(0)} ariaHidden />
            <div className={styles.meta}>
              <div className={styles.name}>
                你的伙伴 <span className={styles.accent}>{state.companion.name}</span>
              </div>
              <div className={styles.voice}>{voiceName(state.companion.voice_id)}</div>
            </div>
          </div>
          <div className={styles.links}>
            <Link to="/me/memories" className={styles.link}>
              回忆相册
            </Link>
            <Link to="/me/profile" className={styles.link}>
              画像控制面
            </Link>
          </div>
        </GlassCard>
      ) : state.status === 'none' ? (
        <GlassCard radius="2xl" className={styles.card}>
          <p className={styles.prompt}>还没有伙伴。给它取个名字、挑一种声音，开始你们的故事。</p>
          <Link to="/me/companion" className={styles.cta}>
            认识你的伙伴
          </Link>
        </GlassCard>
      ) : (
        <GlassCard radius="2xl" className={styles.card}>
          <p className={styles.prompt}>伙伴信息暂时读不出来，稍后再试。</p>
        </GlassCard>
      )}
    </section>
  )
}
