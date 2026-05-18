import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchLeaderboard } from '@/utils/leaderboard-api'
import {
  clearOptimisticEntry,
  entriesContainOptimistic,
  loadOptimisticEntry,
  mergeOptimisticEntry,
  type OptimisticLeaderboardEntry,
} from '@/utils/leaderboard-optimistic'
import { getTodayString } from '@/utils/date'
import type { LeaderboardEntry } from '@shared/leaderboard-types'
import styles from './LeaderboardPage.module.css'

function isOptimistic(entry: LeaderboardEntry): entry is OptimisticLeaderboardEntry {
  return (entry as OptimisticLeaderboardEntry)._justSubmitted === true
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function LeaderboardPage() {
  const today = getTodayString()
  // Seed from any optimistic entry persisted by the result page so the player
  // sees their freshly-submitted row before the GET resolves.
  const [entries, setEntries] = useState<LeaderboardEntry[]>(() => {
    const optimistic = loadOptimisticEntry(today)
    return optimistic ? [optimistic] : []
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // The fetch + merge body is shared between mount and retry. Synchronous
  // `setLoading(true)` / `setError(false)` are deliberately kept OUT of here so
  // calling it from `useEffect` doesn't trigger react-hooks/set-state-in-effect;
  // the mount path relies on the initial `loading: true` / `error: false` state,
  // and the retry handler resets both before calling this.
  const fetchEntries = useCallback(() => {
    fetchLeaderboard(today).then((data) => {
      setLoading(false)
      if (data) {
        // Server response is authoritative. If an optimistic entry is still
        // around AND the GET payload doesn't yet include it (cache hasn't
        // flipped), splice it in at its claimed rank so the player still sees
        // it. Once the cache flips and the GET contains the real row, drop the
        // optimistic copy and let the server response stand on its own.
        const optimistic = loadOptimisticEntry(today)
        if (optimistic && !entriesContainOptimistic(data.entries, optimistic)) {
          setEntries(mergeOptimisticEntry(data.entries, optimistic))
        } else {
          if (optimistic) clearOptimisticEntry(today)
          setEntries(data.entries)
        }
      } else {
        setError(true)
      }
    })
  }, [today])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const handleRetry = useCallback(() => {
    setLoading(true)
    setError(false)
    fetchEntries()
  }, [fetchEntries])

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>排行榜</h1>
      <p className={styles.notice}>每日 — {today}</p>

      {loading && <p className={styles.status}>加载中…</p>}
      {error && (
        <div className={styles.errorBlock}>
          <p className={styles.status}>排行榜暂不可用，稍后再试。</p>
          <button type="button" className={styles.retryBtn} onClick={handleRetry}>
            重试
          </button>
          <p className={styles.statusMuted}>若一直无法访问，可邮件 byheaven0912@gmail.com 反馈</p>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className={styles.status}>今日还没有成绩，来抢第一！</p>
      )}

      {entries.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>排名</th>
              <th>昵称</th>
              <th>用时</th>
              <th>次数</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.rank} data-just-submitted={isOptimistic(row) ? 'true' : undefined}>
                <td className={styles.rank}>#{row.rank}</td>
                <td>{row.nickname}</td>
                <td className={styles.time}>{formatMs(row.time_ms)}</td>
                <td>{row.attempt_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Link to="/" className={styles.link}>
        ← 首页
      </Link>
    </main>
  )
}
