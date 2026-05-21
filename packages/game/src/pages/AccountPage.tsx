import Button from '@/components/ui/Button'
import ConicAvatar from '@/components/ui/ConicAvatar'
import EyebrowTag from '@/components/ui/EyebrowTag'
import GlassCard from '@/components/ui/GlassCard'
import { badges, recentRuns } from '@/mocks/account'
import { mockUser } from '@/mocks/auth'
import styles from './AccountPage.module.css'

/* Account page — handoff §6.11. A profile card (identity + stats) beside
   a「最近 5 局」run table and a 勋章 badge grid. Platform chrome — every
   accent is brand yellow; no BombSquad cyan on this surface. */
export default function AccountPage() {
  const fullName = `${mockUser.avatarLetter}${mockUser.displayName}`
  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">我的 · ACCOUNT</EyebrowTag>
      <h2 className={styles.title}>
        <span className={styles.accent}>{mockUser.displayName}</span> 的星轨。
      </h2>
      <p className={styles.lead}>你的战绩、连胜、个人最快记录。所有数据只属于你。</p>

      <div className={styles.grid}>
        <GlassCard radius="2xl" className={styles.profile}>
          <div className={styles.avatar}>
            <ConicAvatar size={96} letter={mockUser.avatarLetter} ariaHidden />
          </div>
          <div className={styles.name}>{fullName}</div>
          <div className={styles.rank}>
            本周 #{mockUser.weekRank} · 累计 #{mockUser.totalRank.toLocaleString('en-US')}
          </div>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statValue}>{mockUser.streakDays}</div>
              <div className={styles.statLabel}>连胜</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{mockUser.completed}</div>
              <div className={styles.statLabel}>已完成</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{mockUser.fastest}</div>
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
    </div>
  )
}
