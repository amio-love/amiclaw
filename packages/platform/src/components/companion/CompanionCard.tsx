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
          {/* Identity on the left, the stat cluster on the right — the row uses
              the full card width and wraps to a stacked layout on narrow mobile
              so the stats never leave a right-empty gap. */}
          <div className={styles.header}>
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

/* The companionship stats cluster — three pills, idiomatic StatPill usage
   (number+unit in `value`, a clean Chinese word in `label`; no "·", which
   belongs to bilingual eyebrows, not stat copy):
     - 「在一起 X 天」 — REAL, from the companion's `created_at`.
     - 「完成 N 局」/「成功 N 次」 — always shown, an honest 0 in production until
       the per-user game-stats source lands; illustrative numbers in seed mode. */
function CompanionStatsStrip({ createdAt, stats }: { createdAt: string; stats: CompanionStats }) {
  const days = daysTogether(createdAt)
  return (
    <div className={styles.stats}>
      {days >= 1 ? (
        <StatPill value={`${days} 天`} label="在一起" />
      ) : (
        <StatPill value="今天" label="认识你" />
      )}
      <StatPill value={`${stats.games_completed} 局`} label="完成" />
      <StatPill value={`${stats.successes} 次`} label="成功" />
    </div>
  )
}
