import { EyebrowTag } from '@amiclaw/ui'
import DailyLeaderboardList from '@/components/leaderboard/DailyLeaderboardList'
import { toChineseDateString } from '@shared/date'
import styles from './LeaderboardPage.module.css'

/* Leaderboard page — handoff §6.9. Only the 每日 board exists: it reads the
   real daily API (DailyLeaderboardList). There is NO week / month / all-time
   aggregation backend (the API stores per-day KV only), so those tabs are not
   shown — surfacing them would promise aggregates the product does not track. */
export default function LeaderboardPage() {
  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">排行榜 · LEADERBOARD</EyebrowTag>
      <h2 className={styles.title}>
        BombSquad · <span className={styles.accent}>每日</span>
      </h2>
      <p className={styles.lead}>{toChineseDateString()} · 每日 UTC 0 点重置。</p>

      <div className={styles.card}>
        <DailyLeaderboardList />
      </div>
    </div>
  )
}
