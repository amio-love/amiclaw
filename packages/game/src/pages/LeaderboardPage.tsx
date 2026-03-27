import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchLeaderboard } from '@/utils/leaderboard-api'
import { getTodayString } from '@/utils/date'
import type { LeaderboardEntry } from '@shared/leaderboard-types'
import styles from './LeaderboardPage.module.css'

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function LeaderboardPage() {
  const today = getTodayString()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchLeaderboard(today).then(data => {
      setLoading(false)
      if (data) {
        setEntries(data.entries)
      } else {
        setError(true)
      }
    })
  }, [today])

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>LEADERBOARD</h1>
      <p className={styles.notice}>DAILY — {today}</p>

      {loading && <p className={styles.status}>Loading…</p>}
      {error && <p className={styles.status}>Leaderboard unavailable. Check back later.</p>}

      {!loading && !error && entries.length === 0 && (
        <p className={styles.status}>No scores yet today. Be the first!</p>
      )}

      {entries.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Nickname</th>
              <th>Time</th>
              <th>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(row => (
              <tr key={row.rank}>
                <td className={styles.rank}>#{row.rank}</td>
                <td>{row.nickname}</td>
                <td className={styles.time}>{formatMs(row.time_ms)}</td>
                <td>{row.attempt_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Link to="/" className={styles.link}>← Home</Link>
    </main>
  )
}
