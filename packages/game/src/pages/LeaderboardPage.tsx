import { Link } from 'react-router-dom'
import styles from './LeaderboardPage.module.css'

// Placeholder data — wired to real API in Phase 5
const PLACEHOLDER_ROWS = [
  { rank: 1, nickname: 'neo_defuser', time: '02:31', attempts: 2, aiTool: 'Claude' },
  { rank: 2, nickname: 'bombqueen99', time: '03:07', attempts: 1, aiTool: 'ChatGPT' },
  { rank: 3, nickname: 'wiredreams', time: '03:44', attempts: 3, aiTool: 'Claude' },
  { rank: 4, nickname: 'gpt_handler', time: '04:12', attempts: 1, aiTool: 'Gemini' },
  { rank: 5, nickname: 'sparkplug77', time: '05:01', attempts: 4, aiTool: 'Claude' },
]

export default function LeaderboardPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>LEADERBOARD</h1>
      <p className={styles.notice}>DAILY — {new Date().toISOString().slice(0, 10)} (placeholder data)</p>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Nickname</th>
            <th>Time</th>
            <th>Attempts</th>
            <th>AI Tool</th>
          </tr>
        </thead>
        <tbody>
          {PLACEHOLDER_ROWS.map(row => (
            <tr key={row.rank}>
              <td className={styles.rank}>#{row.rank}</td>
              <td>{row.nickname}</td>
              <td className={styles.time}>{row.time}</td>
              <td>{row.attempts}</td>
              <td>{row.aiTool}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Link to="/" className={styles.link}>← Home</Link>
    </main>
  )
}
