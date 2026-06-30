import { Link } from 'react-router-dom'
import { ConicAvatar, GlassCard, StatPill } from '@amiclaw/ui'
import type { CompanionStats } from '@/lib/companion-api'
import { useCompanion } from '@/hooks/useCompanion'
import { voiceName } from '@/lib/companion-voices'
import { daysTogether } from '@/lib/companion-format'
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
          <CompanionStatsStrip createdAt={state.companion.created_at} stats={state.stats} />
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

/* The companionship stats strip.
     - 「在一起 X 天」 is REAL — computed from the companion's `created_at` — so it
       always shows, in production too.
     - 「完成 N 局」/「成功 N 次」 have no real per-user source yet (they need the
       leaderboard user_id migration + the capture pipeline), so they come from
       an optional `stats` object populated ONLY in seed mode. In production
       `stats` is undefined and these two are hidden entirely — never a fake 0. */
function CompanionStatsStrip({ createdAt, stats }: { createdAt: string; stats?: CompanionStats }) {
  const days = daysTogether(createdAt)
  return (
    <div className={styles.stats}>
      {days >= 1 ? (
        <StatPill value={days} label="在一起 · 天" />
      ) : (
        <StatPill value="今天" label="认识你" />
      )}
      {stats ? (
        <>
          <StatPill value={stats.games_completed} label="完成 · 局" />
          <StatPill value={stats.successes} label="成功 · 次" />
        </>
      ) : null}
    </div>
  )
}
