import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useGame } from '@/store/game-context'
import { copyToClipboard } from '@/utils/clipboard'
import { getTodayString } from '@/utils/date'
import { getDeviceId } from '@/utils/device-fingerprint'
import { submitScore } from '@/utils/leaderboard-api'
import type { ScoreSubmissionResponse } from '@shared/leaderboard-types'
import styles from './ResultPage.module.css'

const MODULE_LABELS = ['Wire', 'Dial', 'Button', 'Keypad']

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function ResultPage() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const [copied, setCopied] = useState(false)
  const [rankResult, setRankResult] = useState<ScoreSubmissionResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitFailed, setSubmitFailed] = useState(false)
  const [retried, setRetried] = useState(false)

  const totalMs =
    state.totalStartTime !== null && state.totalEndTime !== null
      ? state.totalEndTime - state.totalStartTime
      : null

  const buildSubmission = useCallback(() => {
    if (totalMs === null) return null
    return {
      date: getTodayString(),
      nickname: 'Anonymous',
      time_ms: Math.round(totalMs),
      attempt_number: state.attemptNumber,
      module_times: state.moduleStats.map((s) => Math.round(s.timeMs)),
      operations_hash: 'practice', // placeholder — real hash in future phase
      device_id: getDeviceId(),
    }
  }, [totalMs, state.attemptNumber, state.moduleStats])

  // Submit score on mount (daily mode only)
  useEffect(() => {
    if (state.mode !== 'daily' || totalMs === null || state.moduleStats.length === 0) return

    const submission = buildSubmission()
    if (!submission) return

    // Persist locally so a retry can succeed even if user navigates back
    try {
      sessionStorage.setItem(`pending-score:${submission.date}`, JSON.stringify(submission))
    } catch {
      /* storage full */
    }

    setSubmitting(true)
    submitScore(submission).then((result) => {
      setSubmitting(false)
      if (result) {
        setRankResult(result)
        try {
          sessionStorage.removeItem(`pending-score:${submission.date}`)
        } catch {
          /* ignore */
        }
      } else {
        setSubmitFailed(true)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRetrySubmit = useCallback(() => {
    setRetried(true)
    setSubmitFailed(false)
    setSubmitting(true)
    const submission = buildSubmission()
    if (!submission) {
      setSubmitting(false)
      return
    }
    submitScore(submission).then((result) => {
      setSubmitting(false)
      if (result) {
        setRankResult(result)
        try {
          sessionStorage.removeItem(`pending-score:${submission.date}`)
        } catch {
          /* ignore */
        }
      } else {
        setSubmitFailed(true)
      }
    })
  }, [buildSubmission])

  const handlePlayAgain = () => {
    dispatch({ type: 'RESET' })
    navigate(`/game?mode=${state.mode}`)
  }

  const buildSummary = useCallback(() => {
    const date = getTodayString()
    const modeLabel =
      state.mode === 'daily' ? `Daily Challenge (Attempt #${state.attemptNumber})` : 'Practice'
    const timeStr = totalMs !== null ? formatMs(totalMs) : '--:--'
    const breakdown = state.moduleStats
      .map((s, i) => {
        const name = MODULE_LABELS[i] ?? s.moduleType
        const t = formatMs(s.timeMs)
        const resets = s.errorCount
        return `${i + 1}. ${name.padEnd(7)} — ${t}  (${resets} reset${resets !== 1 ? 's' : ''})`
      })
      .join('\n')
    const rankLine = rankResult
      ? `Global Rank: #${rankResult.rank} of ${rankResult.total_players}`
      : ''

    return `=== BombSquad Result ===
Date: ${date}
Mode: ${modeLabel}
Result: Success ✓
Total Time: ${timeStr}
${rankLine ? `${rankLine}\n` : ''}
Module Breakdown:
${breakdown}

Debrief prompt:
Review our run and tell me: what caused the most delays, and what should we add to our strategy?`
  }, [state, totalMs, rankResult])

  const handleCopySummary = async () => {
    const ok = await copyToClipboard(buildSummary())
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (state.moduleStats.length === 0) {
    return (
      <main className={styles.page}>
        <p className={styles.noData}>
          No game data.{' '}
          <Link to="/" className={styles.link}>
            Go Home
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <h1 className={`${styles.header} ${styles.headerDefused}`}>DEFUSED</h1>

      {totalMs !== null && <div className={styles.totalTime}>{formatMs(totalMs)}</div>}

      <p className={styles.meta}>
        {state.mode === 'daily' ? `Daily Challenge — Attempt #${state.attemptNumber}` : 'Practice'}
      </p>

      {state.mode === 'daily' && (
        <div className={styles.rankBlock}>
          {submitting && <span className={styles.rankMuted}>Submitting score…</span>}
          {rankResult && (
            <span className={styles.rankValue}>
              Global Rank: <strong>#{rankResult.rank}</strong> / {rankResult.total_players}
            </span>
          )}
          {submitFailed && (
            <span className={styles.rankMuted}>
              Could not submit score (offline?)
              {!retried && (
                <button className={styles.retryBtn} onClick={handleRetrySubmit}>
                  Try again
                </button>
              )}
            </span>
          )}
        </div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Module Breakdown</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Module</th>
              <th>Time</th>
              <th>Resets</th>
            </tr>
          </thead>
          <tbody>
            {state.moduleStats.map((stat, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{MODULE_LABELS[i] ?? stat.moduleType}</td>
                <td className={styles.timeCell}>{formatMs(stat.timeMs)}</td>
                <td className={styles.errorCell}>{stat.errorCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className={styles.actions}>
        <button className={styles.btnPlayAgain} onClick={handlePlayAgain}>
          PLAY AGAIN
        </button>
        <button
          className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
          onClick={handleCopySummary}
        >
          {copied ? 'COPIED!' : 'Copy Run Summary'}
        </button>
        <div className={styles.secondaryLinks}>
          <Link to="/leaderboard" className={styles.link}>
            Leaderboard
          </Link>
          <Link to="/" className={styles.link}>
            Home
          </Link>
        </div>
      </div>
    </main>
  )
}
