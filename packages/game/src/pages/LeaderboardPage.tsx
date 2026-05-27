import { useState } from 'react'
import { EyebrowTag } from '@amiclaw/ui'
import DailyLeaderboardList from '@/components/leaderboard/DailyLeaderboardList'
import MockLeaderboardList from '@/components/leaderboard/MockLeaderboardList'
import { allTimeRows, monthRows, weekRows } from '@/mocks/leaderboard'
import { toChineseDateString } from '@/utils/date'
import styles from './LeaderboardPage.module.css'

type LeaderboardTab = 'daily' | 'week' | 'month' | 'all'

const TABS: { id: LeaderboardTab; label: string }[] = [
  { id: 'daily', label: '每日' },
  { id: 'week', label: '本周' },
  { id: 'month', label: '本月' },
  { id: 'all', label: '历史' },
]

/* Leaderboard page — handoff §6.9. A 4-tab pill switch over one
   leaderboard card: 每日 is the real daily API (DailyLeaderboardList);
   本周 / 本月 / 历史 are mock aggregates (MockLeaderboardList). */
export default function LeaderboardPage() {
  const [tab, setTab] = useState<LeaderboardTab>('daily')

  return (
    <div className={styles.page}>
      <EyebrowTag variant="section">排行榜 · LEADERBOARD</EyebrowTag>
      <h2 className={styles.title}>
        BombSquad · <span className={styles.accent}>每日</span>
      </h2>
      <p className={styles.lead}>
        {toChineseDateString()} · 每日 UTC 0 点重置。前 100 名进入本周聚合榜。
      </p>

      <div className={styles.card}>
        <div className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? `${styles.tab} ${styles.tabOn}` : styles.tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'daily' && <DailyLeaderboardList />}
        {tab === 'week' && <MockLeaderboardList entries={weekRows} />}
        {tab === 'month' && <MockLeaderboardList entries={monthRows} />}
        {tab === 'all' && <MockLeaderboardList entries={allTimeRows} />}
      </div>
    </div>
  )
}
