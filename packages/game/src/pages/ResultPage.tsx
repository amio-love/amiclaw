import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import NicknameModal from '@/components/NicknameModal'
import { useGame } from '@/store/game-context'
import { copyToClipboard } from '@/utils/clipboard'
import { getTodayString } from '@/utils/date'
import { getDeviceId } from '@/utils/device-fingerprint'
import { logEvent } from '@/utils/event-log'
import { submitScore } from '@/utils/leaderboard-api'
import { saveOptimisticEntry } from '@/utils/leaderboard-optimistic'
import { getStoredNickname } from '@/utils/nickname'
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

  // Daily mode submits a score. Practice mode never submits and never asks
  // for a nickname.
  const hasFinishedDailyRun =
    state.mode === 'daily' && totalMs !== null && state.moduleStats.length > 0

  // Lazy initializers: read the stored nickname once on mount. Subsequent
  // useState calls reuse the captured value so the three pieces of mount
  // state stay consistent without triple-reading localStorage.
  const [nickname, setNickname] = useState<string | null>(() => getStoredNickname())
  const [nicknameModalOpen, setNicknameModalOpen] = useState(
    () => hasFinishedDailyRun && nickname === null
  )
  // Initialize submitting=true only when the effect below will actually fire a
  // request, so we avoid a synchronous setState in the effect body
  // (react-hooks/set-state-in-effect). First-visit daily runs wait for the
  // modal confirmation before flipping submitting=true.
  const [submitting, setSubmitting] = useState(() => hasFinishedDailyRun && nickname !== null)

  const buildSubmission = useCallback(
    (nicknameValue: string): ScoreSubmission | null => {
      if (totalMs === null) return null
      return {
        date: getTodayString(),
        nickname: nicknameValue,
        time_ms: Math.round(totalMs),
        attempt_number: state.attemptNumber,
        module_times: state.moduleStats.map((s) => Math.round(s.timeMs)),
        operations_hash: 'mvp-placeholder', // temporary placeholder until real run hashing is implemented
        device_id: getDeviceId(),
      }
    },
    [totalMs, state.attemptNumber, state.moduleStats]
  )

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

  // Fires the actual submission. Callers own `submitting` toggles — the mount
  // path relies on the lazy `useState` initializer above to start truthy, and
  // the modal-confirm path flips it on synchronously before calling here.
  // Keeping `setSubmitting(true)` out of this function lets us call it from
  // inside `useEffect` without tripping react-hooks/set-state-in-effect.
  const performSubmission = useCallback(
    (nicknameValue: string) => {
      const submission = buildSubmission(nicknameValue)
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
    },
    [buildSubmission, recordOptimistic]
  )

  // Submit score on mount when a nickname is already known (returning daily
  // player). First-visit daily players wait for the modal handler below.
  useEffect(() => {
    if (!hasFinishedDailyRun) return
    if (nickname === null) return
    performSubmission(nickname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNicknameConfirm = useCallback(
    (value: string) => {
      setNickname(value)
      setNicknameModalOpen(false)
      setSubmitting(true)
      performSubmission(value)
    },
    [performSubmission]
  )

  const handleRetrySubmit = useCallback(() => {
    if (nickname === null) return
    setRetried(true)
    setSubmitFailed(false)
    setSubmitting(true)
    const submission = buildSubmission(nickname)
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
  }, [buildSubmission, recordOptimistic, nickname])

  const handlePlayAgain = () => {
    // Emit BEFORE the RESET so we still capture the just-finished run's mode
    // and attempt number — after RESET those revert to INITIAL_STATE values
    // and the signal is lost.
    logEvent('replay_intent', {
      mode: state.mode,
      attemptNumber: state.attemptNumber,
    })
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
          {nicknameModalOpen && <span className={styles.rankMuted}>提交前请填写昵称</span>}
          {!nicknameModalOpen && submitting && (
            <span className={styles.rankMuted}>提交成绩中…</span>
          )}
          {rankResult && (
            <span className={styles.rankValue}>
              全球排名：<strong>#{rankResult.rank}</strong> / {rankResult.total_players}
            </span>
          )}
          {submitFailed &&
            (retried ? (
              <span className={styles.rankMuted}>
                网络不稳定，可下次再来重新提交。或邮件反馈 byheaven0912@gmail.com
              </span>
            ) : (
              <span className={styles.rankMuted}>
                提交失败（可能离线）
                <button className={styles.retryBtn} onClick={handleRetrySubmit}>
                  重试
                </button>
              </span>
            ))}
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

      <NicknameModal open={nicknameModalOpen} onConfirm={handleNicknameConfirm} />
    </main>
  )
}
