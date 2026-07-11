import { useCallback, useEffect, useState } from 'react'
import { Button, Disclosure } from '@amiclaw/ui'
import { fetchArcadeStreakLeaderboard } from '@amiclaw/arcade-profile/api-client'
import type { ArcadeStreakLeaderboardEntry } from '@amiclaw/arcade-profile/types'
import { getTodayString, toChineseDateString } from '@shared/date'
import styles from './StreakLeaderboardList.module.css'

function todayText(entry: ArcadeStreakLeaderboardEntry): string {
  const completed = [
    entry.today.bombsquad_defused ? 'BombSquad' : null,
    entry.today.oracle_signed ? 'Oracle' : null,
  ].filter((item): item is string => item !== null)
  return completed.length > 0 ? `今日 ${completed.join(' + ')}` : '今日未完成'
}

export default function StreakLeaderboardList() {
  const today = getTodayString()
  const [entries, setEntries] = useState<ArcadeStreakLeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    fetchArcadeStreakLeaderboard({ date: today, limit: 50 }).then((result) => {
      setLoading(false)
      if (result.kind === 'ok') {
        setEntries(result.board.entries)
      } else {
        setError(true)
      }
    })
  }, [today])

  useEffect(() => {
    load()
  }, [load])

  const handleRetry = useCallback(() => {
    setLoading(true)
    setError(false)
    load()
  }, [load])

  if (loading) return <p className={styles.status}>加载中…</p>
  if (error) {
    return (
      <div className={styles.errorBlock}>
        <p className={styles.status}>连续榜暂不可用，稍后再试。</p>
        <Button variant="ghost" size="sm" onClick={handleRetry}>
          重试
        </Button>
      </div>
    )
  }
  if (entries.length === 0) {
    // rc §3: the default state is the warm invitation; the "how to get on the
    // board" mechanics move behind the ⓘ.
    return (
      <p className={styles.status}>
        还没有人上榜，第一个来占位吧。
        <Disclosure label="怎么上榜">登录并保存本设备记录到账号后，就会公开展示上榜名。</Disclosure>
      </p>
    )
  }

  return (
    <div className={styles.list} role="table" aria-label="连续打卡榜">
      <div className={styles.headRow} role="row">
        <span role="columnheader">名次</span>
        <span role="columnheader">玩家</span>
        <span className={styles.headScore} role="columnheader">
          连续
        </span>
      </div>
      {entries.map((entry) => (
        <div key={`${entry.rank}-${entry.public_label}`} className={styles.row} role="row">
          <span className={styles.rank} role="cell">
            #{String(entry.rank).padStart(3, '0')}
          </span>
          <span className={styles.nameCell} role="cell">
            <span className={styles.name}>{entry.public_label}</span>
            <span className={styles.meta}>
              {todayText(entry)} · 最近 {toChineseDateString(entry.last_active_date)}
            </span>
          </span>
          <span className={styles.score} role="cell">
            {entry.current_streak_days} 天
            <span className={styles.scoreSub}>最长 {entry.longest_streak_days} 天</span>
          </span>
        </div>
      ))}
    </div>
  )
}
