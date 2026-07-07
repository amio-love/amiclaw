import { useState } from 'react'
import { EyebrowTag } from '@amiclaw/ui'
import BoardDateSwitcher from '@/components/leaderboard/BoardDateSwitcher'
import DailyLeaderboardList from '@/components/leaderboard/DailyLeaderboardList'
import StreakLeaderboardList from '@/components/leaderboard/StreakLeaderboardList'
import { getBoardDays } from '@/lib/board-dates'
import { getDailyResetHint, toChineseDateString } from '@shared/date'
import { LEADERBOARD_RETENTION_DAYS } from '@shared/leaderboard-types'
import styles from './LeaderboardPage.module.css'

/* Leaderboard page — BombSquad's daily time board remains the KV-backed daily
   leaderboard. The public streak board is a separate arcade-profile read
   model backed by claimed public profiles, not by leaderboard rows.

   The daily board is date-navigable via the compact switcher in the section
   head, over exactly the LEADERBOARD_RETENTION_DAYS the KV storage actually
   guarantees (today + yesterday) — navigating further would render a false
   「无人上榜」for boards whose data simply expired. The retention boundary is
   stated honestly under the board (older PERSONAL records stay in the /me
   7-day history; the public board itself is not retained). Past boards read
   straight from the same `?date=` API; switching re-mounts the list (`key`)
   so each board starts from a clean loading state. The streak board is
   always "as of today" and does not navigate. */
export default function LeaderboardPage() {
  const [days] = useState(() => getBoardDays(LEADERBOARD_RETENTION_DAYS))
  const [dayIndex, setDayIndex] = useState(0)
  const selectedDay = days[dayIndex]

  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">排行榜 · LEADERBOARD</EyebrowTag>
      <h2 className={styles.title}>
        Arcade · <span className={styles.accent}>每日</span>
      </h2>
      <p className={styles.lead}>
        {toChineseDateString(selectedDay.date)} · {getDailyResetHint()}
      </p>

      <div className={styles.boardGrid}>
        <section className={styles.boardSection}>
          <div className={`${styles.sectionHead} ${styles.sectionHeadRow}`}>
            <div className={styles.sectionHeadText}>
              <h3 className={styles.sectionTitle}>BombSquad 每日时间榜</h3>
              <p className={styles.sectionLead}>只记录成功拆除的每日挑战成绩。</p>
            </div>
            <BoardDateSwitcher days={days} selectedIndex={dayIndex} onSelect={setDayIndex} />
          </div>
          <div className={styles.card}>
            <DailyLeaderboardList key={selectedDay.date} date={selectedDay.date} />
          </div>
          {/* Honest retention boundary — keep the day wording in sync with
              LEADERBOARD_RETENTION_DAYS (2: 今天和昨天). */}
          <p className={styles.boardNote}>
            每日榜只保留今天和昨天，更早的日榜未保存；个人记录在「我的」页保留最近 7 天。
          </p>
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
