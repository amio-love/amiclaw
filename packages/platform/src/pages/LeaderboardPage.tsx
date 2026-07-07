import { EyebrowTag } from '@amiclaw/ui'
import DailyLeaderboardList from '@/components/leaderboard/DailyLeaderboardList'
import StreakLeaderboardList from '@/components/leaderboard/StreakLeaderboardList'
import { getDailyResetHint, toChineseDateString } from '@shared/date'
import styles from './LeaderboardPage.module.css'

/* Leaderboard page — BombSquad's daily time board remains the KV-backed daily
   leaderboard. The public streak board is a separate arcade-profile read
   model backed by claimed public profiles, not by leaderboard rows. */
export default function LeaderboardPage() {
  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">排行榜 · LEADERBOARD</EyebrowTag>
      <h2 className={styles.title}>
        Arcade · <span className={styles.accent}>每日</span>
      </h2>
      <p className={styles.lead}>
        {toChineseDateString()} · {getDailyResetHint()}
      </p>

      <div className={styles.boardGrid}>
        <section className={styles.boardSection}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>BombSquad 每日时间榜</h3>
            <p className={styles.sectionLead}>只记录成功拆除的每日挑战成绩。</p>
          </div>
          <div className={styles.card}>
            <DailyLeaderboardList />
          </div>
        </section>

        <section className={styles.boardSection}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>连续打卡榜</h3>
            <p className={styles.sectionLead}>登录并保存到账号后公开展示上榜名。</p>
          </div>
          <div className={styles.card}>
            <StreakLeaderboardList />
          </div>
        </section>
      </div>
    </div>
  )
}
