import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useGame } from '@/store/game-context'
import { copyToClipboard } from '@/utils/clipboard'
import { getTodayString } from '@/utils/date'
import { getDeviceId } from '@/utils/device-fingerprint'
import { submitScore } from '@/utils/leaderboard-api'
import { saveOptimisticEntry } from '@/utils/leaderboard-optimistic'
import type { ScoreSubmission, ScoreSubmissionResponse } from '@shared/leaderboard-types'
import styles from './ResultPage.module.css'

const MODULE_LABELS = ['线路', '密码盘', '按钮', '键盘']

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
  const [submitFailed, setSubmitFailed] = useState(false)
  const [retried, setRetried] = useState(false)

  const totalMs =
    state.totalStartTime !== null && state.totalEndTime !== null
      ? state.totalEndTime - state.totalStartTime
      : null

  // Initialize submitting=true when the effect below will actually fire a request,
  // so we avoid a synchronous setState in the effect body (react-hooks/set-state-in-effect).
  const [submitting, setSubmitting] = useState(
    () => state.mode === 'daily' && totalMs !== null && state.moduleStats.length > 0
  )

  const buildSubmission = useCallback((): ScoreSubmission | null => {
    if (totalMs === null) return null
    return {
      date: getTodayString(),
      nickname: 'Anonymous',
      time_ms: Math.round(totalMs),
      attempt_number: state.attemptNumber,
      module_times: state.moduleStats.map((s) => Math.round(s.timeMs)),
      operations_hash: 'mvp-placeholder', // temporary placeholder until real run hashing is implemented
      device_id: getDeviceId(),
    }
  }, [totalMs, state.attemptNumber, state.moduleStats])

  const recordOptimistic = useCallback(
    (submission: ScoreSubmission, result: ScoreSubmissionResponse) => {
      saveOptimisticEntry(submission.date, {
        rank: result.rank,
        nickname: submission.nickname,
        time_ms: submission.time_ms,
        attempt_number: submission.attempt_number,
        ai_tool: submission.ai_tool,
      })
    },
    []
  )

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

    submitScore(submission).then((result) => {
      setSubmitting(false)
      if (result) {
        setRankResult(result)
        recordOptimistic(submission, result)
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
        recordOptimistic(submission, result)
        try {
          sessionStorage.removeItem(`pending-score:${submission.date}`)
        } catch {
          /* ignore */
        }
      } else {
        setSubmitFailed(true)
      }
    })
  }, [buildSubmission, recordOptimistic])

  const handlePlayAgain = () => {
    dispatch({ type: 'RESET' })
    navigate(`/game?mode=${state.mode}`)
  }

  const buildSummary = useCallback(() => {
    const date = getTodayString()
    const modeLabel = state.mode === 'daily' ? `每日挑战（第 ${state.attemptNumber} 次）` : '练习'
    const timeStr = totalMs !== null ? formatMs(totalMs) : '--:--'
    const breakdown = state.moduleStats
      .map((s, i) => {
        const name = MODULE_LABELS[i] ?? s.moduleType
        const t = formatMs(s.timeMs)
        const resets = s.errorCount
        return `${i + 1}. ${name}模块 - ${t} - 成功 (${resets} 次重置)`
      })
      .join('\n')
    const rankLine = rankResult ? `全球排名：#${rankResult.rank} / ${rankResult.total_players}` : ''

    return `=== BombSquad 结果摘要 ===
日期：${date}
模式：${modeLabel}
结果：成功 ✅
总用时：${timeStr}
${rankLine ? `${rankLine}\n` : ''}
模块详情：
${breakdown}

请和我一起复盘：
帮我看看这一局 —— 哪一块拖了最多时间？我们下次该怎么改进沟通？`
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
          暂无数据。{' '}
          <Link to="/" className={styles.link}>
            返回首页
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <h1 className={`${styles.header} ${styles.headerDefused}`}>拆弹成功</h1>

      {totalMs !== null && <div className={styles.totalTime}>{formatMs(totalMs)}</div>}

      <p className={styles.meta}>
        {state.mode === 'daily' ? `每日挑战 — 第 ${state.attemptNumber} 次` : '练习'}
      </p>

      {state.mode === 'daily' && (
        <div className={styles.rankBlock}>
          {submitting && <span className={styles.rankMuted}>提交成绩中…</span>}
          {rankResult && (
            <span className={styles.rankValue}>
              全球排名：<strong>#{rankResult.rank}</strong> / {rankResult.total_players}
            </span>
          )}
          {submitFailed && (
            <span className={styles.rankMuted}>
              提交失败（可能离线）
              {!retried && (
                <button className={styles.retryBtn} onClick={handleRetrySubmit}>
                  重试
                </button>
              )}
            </span>
          )}
        </div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>模块用时</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>模块</th>
              <th>用时</th>
              <th>重置</th>
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
          再来一局
        </button>
        <button
          className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
          onClick={handleCopySummary}
        >
          {copied ? '已复制！' : '复制赛后摘要'}
        </button>
        <div className={styles.secondaryLinks}>
          <Link to="/leaderboard" className={styles.link}>
            排行榜
          </Link>
          <Link to="/" className={styles.link}>
            首页
          </Link>
        </div>
      </div>
    </main>
  )
}
