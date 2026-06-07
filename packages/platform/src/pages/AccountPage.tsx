import { Link } from 'react-router-dom'
import { Button, ConicAvatar, EyebrowTag, GlassCard } from '@amiclaw/ui'
import { badges, recentRuns } from '@/mocks/account'
import type { MockUser } from '@/mocks/auth'
import { useAuth } from '@/hooks/useAuth'
import styles from './AccountPage.module.css'

/* Account page — handoff §6.11. A profile card (identity + stats) beside
   a「最近 5 局」run table and a 勋章 badge grid. Platform chrome — every
   accent is brand yellow; no BombSquad cyan on this surface.

   The page reads identity from useAuth(): a signed-in visitor sees the
   profile; an anonymous visitor gets a login-guide empty state instead of
   another user's profile (mirrors GamesPage's signed-in / anonymous split). */
export default function AccountPage() {
  const { signedIn, user } = useAuth()

  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">我的 · ACCOUNT</EyebrowTag>
      {signedIn && user ? <SignedInProfile user={user} /> : <SignedOutGuide />}
    </div>
  )
}

/* The signed-in profile — identity and stats come from the authenticated
   `user`; recentRuns / badges are the demo user's run history and badge wall. */
function SignedInProfile({ user }: { user: MockUser }) {
  const fullName = `${user.avatarLetter}${user.displayName}`
  return (
    <>
      <h2 className={styles.title}>
        <span className={styles.accent}>{user.displayName}</span> 的星轨。
      </h2>
      <p className={styles.lead}>你的战绩、连胜、个人最快记录。所有数据只属于你。</p>

      <div className={styles.grid}>
        <GlassCard radius="2xl" className={styles.profile}>
          <div className={styles.avatar}>
            <ConicAvatar size={96} letter={user.avatarLetter} ariaHidden />
          </div>
          <div className={styles.name}>{fullName}</div>
          <div className={styles.rank}>
            本周 #{user.weekRank} · 累计 #{user.totalRank.toLocaleString('en-US')}
          </div>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statValue}>{user.streakDays}</div>
              <div className={styles.statLabel}>连胜</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{user.completed}</div>
              <div className={styles.statLabel}>已完成</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{user.fastest}</div>
              <div className={styles.statLabel}>最快</div>
            </div>
          </div>
          <Button variant="ghost" className={styles.settingsBtn}>
            账户设置
          </Button>
        </GlassCard>

        <div className={styles.detail}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>最近 5 局</h3>
            <GlassCard radius="2xl" className={styles.runCard}>
              <div className={styles.runs}>
                {recentRuns.map((run) => (
                  <div key={run.id} className={styles.run}>
                    <div className={styles.runIcon}>{run.icon}</div>
                    <div>
                      <div className={styles.runGame}>{run.game}</div>
                      <div className={styles.runMode}>{run.mode}</div>
                    </div>
                    <div className={styles.runTime}>{run.time}</div>
                    <div className={styles.runRank}>{run.rank}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>勋章</h3>
            <GlassCard radius="2xl" className={styles.badgeCard}>
              <div className={styles.badgeGrid}>
                {badges.map((badge) => (
                  <div key={badge.id} className={styles.badge}>
                    <ConicAvatar size={56} ariaHidden>
                      <span className={styles.badgeStar}>★</span>
                    </ConicAvatar>
                    <div className={styles.badgeName}>{badge.name}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </section>
        </div>
      </div>
    </>
  )
}

/* What signing in unlocks — plain text only. No fake numbers, names, or a
   blurred/skeleton fake-data placeholder; the anonymous visitor must never
   see another user's stats here. */
const UNLOCK_PREVIEW = ['战绩与单局完成率', '连胜与最快记录', '勋章墙']

/* The anonymous empty state — a single login-guide card. Routes to the
   platform homepage (the onboarding/entry surface) via react-router. */
function SignedOutGuide() {
  return (
    <>
      <h2 className={styles.title}>登录后查看你的星轨。</h2>
      <p className={styles.lead}>登录后，这里会显示属于你的战绩、连胜和勋章。</p>

      <GlassCard radius="2xl" className={styles.guideCard}>
        <h3 className={styles.guideTitle}>登录后查看你的星轨</h3>
        <ul className={styles.unlockList}>
          {UNLOCK_PREVIEW.map((item) => (
            <li key={item} className={styles.unlockItem}>
              {item}
            </li>
          ))}
        </ul>
        <Link to="/" className={styles.guideCta}>
          登录 / 开始
        </Link>
      </GlassCard>
    </>
  )
}
