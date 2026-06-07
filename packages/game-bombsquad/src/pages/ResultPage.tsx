import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PostGameModal, { type PostGameModalResult } from '@/components/PostGameModal'
import { Scenery } from '@amiclaw/ui'
import Button from '@/components/bombsquad/Button'
import Glyph, { type GlyphKey } from '@/components/bombsquad/Glyph'
import { useGame, MAX_STRIKES, type GameOutcome } from '@/store/game-context'
import { getTodayString } from '@shared/date'
import { getDeviceId } from '@/utils/device-fingerprint'
import { logEvent } from '@/utils/event-log'
import { formatMs } from '@shared/format-time'
import { submitScore, type SubmitScoreResult } from '@shared/leaderboard-api'
import { saveOptimisticEntry } from '@shared/leaderboard-optimistic'
import { getStoredNickname } from '@/utils/nickname'
import {
  getStoredLeaderboardPlayerMetadata,
  type LeaderboardPlayerMetadata,
} from '@/utils/leaderboard-player-metadata'
import { hasAnsweredSurvey, markSurveyAnswered } from '@/utils/survey'
import { playSfx } from '@/audio/useSfx'
import type { ScoreSubmission, ScoreSubmissionResponse } from '@shared/leaderboard-types'
import styles from './ResultPage.module.css'

// Module label keyed by module kind (the `moduleType` stored on each stat),
// not by position — practice and daily run different module sequences.
// Atlas redesign names (design_handoff_bombsquad README §1): 线路→光弦,
// 密码盘→星盘, 键盘→星符; the button module keeps 按钮.
const MODULE_LABEL: Record<string, string> = {
  wire: '光弦',
  dial: '星盘',
  button: '按钮',
  keypad: '星符',
}

// Decorative celestial glyph per module kind, shown in the result-screen
// breakdown rows. Chosen by metaphor: 光弦 → 弦 (bowstring), 星盘 → 极 (the
// pole star the dial aligns to, README §6.3), 按钮 → 钟 (rhythm), 星符 → 月.
const MODULE_GLYPH: Record<string, GlyphKey> = {
  wire: 'xian',
  dial: 'ji',
  button: 'zhong',
  keypad: 'yue',
}

/** The result screen has two visual variants (handoff README §6.6 / §6.7). */
type ResultVariant = 'success' | 'failure'

/**
 * Map a frozen game outcome to a result variant. `defused` and
 * `practice-cleared` are runs that finished every module → success; `exploded`
 * (a daily 3-strike-out) and the two neutral cap-outs (`practice-timeout` /
 * `daily-timeout`) are runs that stopped short → the gentle 差一点 failure
 * variant. A cap-out never submits to the leaderboard (the run never defused).
 */
function resultVariant(outcome: GameOutcome): ResultVariant {
  return outcome === 'exploded' || outcome === 'practice-timeout' || outcome === 'daily-timeout'
    ? 'failure'
    : 'success'
}

/** AI-voiced consolation line on the failure screen (handoff README §6.7).
 *  Static, non-punishing copy keyed on the real failure cause — restrained and
 *  reasoned (no fabricated per-run advice, no slogans). Each line nudges the
 *  player back to the AI partner for an end-of-round debrief, which is where the
 *  qualitative coaching now lives. */
function consolationText(outcome: GameOutcome, strikeCount: number): string {
  if (outcome === 'exploded' && strikeCount >= MAX_STRIKES) {
    return '三次失误，这一局就到这了 —— 趁记得，跟我聊聊刚才哪几步卡住了，下一局我们会更稳。'
  }
  return '时间走得比想象中快 —— 跟我复盘一下这局哪里慢了，理清思路，下一局再来。'
}

export default function ResultPage() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  const [rankResult, setRankResult] = useState<ScoreSubmissionResponse | null>(null)
  const [submitFailed, setSubmitFailed] = useState(false)
  const [retried, setRetried] = useState(false)
  // Distinguishes a server-side validation rejection from a network failure so
  // the failure copy can be honest. `null` while no failure is showing.
  const [submitFailKind, setSubmitFailKind] = useState<'network' | 'rejected' | null>(null)
  const [submitFailMessage, setSubmitFailMessage] = useState<string | null>(null)

  // Fall back to `defused` for any legacy RESULT state persisted before the
  // game-modes rework added the `outcome` field.
  const outcome: GameOutcome = state.outcome ?? 'defused'
  const variant = resultVariant(outcome)

  // True only when ResultPage was opened with no run in memory at all (distinct
  // from a finished run that solved zero modules — that still carries an
  // outcome). Gates both the "暂无数据" fallback and the success payoff below.
  const noRunData = state.moduleStats.length === 0 && state.outcome === null

  // Success sting on entry — a short, restrained rising chime that marks the
  // arrival, the audible half of the success-only payoff. Failure stays silent
  // (the detonation already played during the EXPLODING animation). Silent-fail
  // when audio is unavailable or muted. Mount-once; StrictMode double-fires it
  // in dev only, like the reducer's logEvent calls.
  useEffect(() => {
    if (variant === 'success' && !noRunData) playSfx('result-success')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalMs =
    state.totalStartTime !== null && state.totalEndTime !== null
      ? state.totalEndTime - state.totalStartTime
      : null

  // Daily mode submits a score — but only on a successful defuse. An
  // exploded run never submits and never asks for a nickname. Practice mode
  // never submits in any case.
  const hasFinishedDailyRun =
    state.mode === 'daily' &&
    outcome === 'defused' &&
    totalMs !== null &&
    state.moduleStats.length > 0

  // Lazy initializers: read the stored nickname once on mount. Subsequent
  // useState calls reuse the captured value so the pieces of mount
  // state stay consistent without triple-reading localStorage.
  const [nickname, setNickname] = useState<string | null>(() => getStoredNickname())
  const [leaderboardMetadata, setLeaderboardMetadata] = useState<LeaderboardPlayerMetadata | null>(
    () => getStoredLeaderboardPlayerMetadata()
  )

  // The unified post-game modal composes two optional sections. The nickname
  // and AI metadata sections are the daily-leaderboard gates; the survey
  // section is shown once per device after any outcome. The modal opens when
  // any section is needed — never as two stacked dialogs. Both `need*` flags
  // are captured once on mount; the modal closes on confirm/skip rather than
  // re-deriving.
  const [needNickname] = useState(() => hasFinishedDailyRun && nickname === null)
  const [needLeaderboardMetadata] = useState(
    () => hasFinishedDailyRun && leaderboardMetadata === null
  )
  const [needSurvey] = useState(() => !hasAnsweredSurvey())
  const [modalOpen, setModalOpen] = useState(
    () => needNickname || needLeaderboardMetadata || needSurvey
  )
  // Initialize submitting=true only when the effect below will actually fire a
  // request, so we avoid a synchronous setState in the effect body
  // (react-hooks/set-state-in-effect). First-visit daily runs wait for the
  // modal confirmation before flipping submitting=true.
  const [submitting, setSubmitting] = useState(
    () => hasFinishedDailyRun && nickname !== null && leaderboardMetadata !== null
  )

  // The daily score is still gated while the modal is open with a leaderboard
  // submission section present.
  const leaderboardGatePending = (needNickname || needLeaderboardMetadata) && modalOpen

  const buildSubmission = useCallback(
    (nicknameValue: string, metadataValue: LeaderboardPlayerMetadata): ScoreSubmission | null => {
      if (totalMs === null) return null
      return {
        date: getTodayString(),
        nickname: nicknameValue,
        time_ms: Math.round(totalMs),
        attempt_number: state.attemptNumber,
        module_times: state.moduleStats.map((s) => Math.round(s.timeMs)),
        operations_hash: 'mvp-placeholder', // temporary placeholder until real run hashing is implemented
        ai_tool: metadataValue.aiTool,
        ...(metadataValue.aiModel ? { ai_model: metadataValue.aiModel } : {}),
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
        ...(submission.ai_model ? { ai_model: submission.ai_model } : {}),
      })
    },
    []
  )

  // Applies a submission outcome to UI state. Centralizes the three-way mapping
  // (success / network failure / server rejection) so the mount, modal-confirm,
  // and retry paths stay in lockstep.
  const applySubmitResult = useCallback(
    (submission: ScoreSubmission, result: SubmitScoreResult) => {
      setSubmitting(false)
      if (result.ok) {
        setSubmitFailed(false)
        setSubmitFailKind(null)
        setSubmitFailMessage(null)
        setRankResult(result.data)
        recordOptimistic(submission, result.data)
        try {
          sessionStorage.removeItem(`pending-score:${submission.date}`)
        } catch {
          /* ignore */
        }
      } else {
        setSubmitFailed(true)
        setSubmitFailKind(result.kind)
        setSubmitFailMessage(result.kind === 'rejected' ? (result.error ?? null) : null)
      }
    },
    [recordOptimistic]
  )

  // Fires the actual submission. Callers own `submitting` toggles — the mount
  // path relies on the lazy `useState` initializer above to start truthy, and
  // the modal-confirm path flips it on synchronously before calling here.
  // Keeping `setSubmitting(true)` out of this function lets us call it from
  // inside `useEffect` without tripping react-hooks/set-state-in-effect.
  const performSubmission = useCallback(
    (nicknameValue: string, metadataValue: LeaderboardPlayerMetadata) => {
      const submission = buildSubmission(nicknameValue, metadataValue)
      if (!submission) return

      // Persist locally so a retry can succeed even if user navigates back
      try {
        sessionStorage.setItem(`pending-score:${submission.date}`, JSON.stringify(submission))
      } catch {
        /* storage full */
      }

      submitScore(submission).then((result) => applySubmitResult(submission, result))
    },
    [buildSubmission, applySubmitResult]
  )

  // Submit score on mount when a nickname is already known (returning daily
  // player). First-visit daily players wait for the modal handler below.
  useEffect(() => {
    if (!hasFinishedDailyRun) return
    if (nickname === null) return
    if (leaderboardMetadata === null) return
    performSubmission(nickname, leaderboardMetadata)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Unified confirm handler. Runs the nickname-confirm path when the nickname
  // section was present, and emits `survey_submit` only when the survey was
  // actually completed. Whenever the survey section was shown, the device is
  // marked answered on confirm — a confirm-past with no answers still retires
  // the survey so it never reappears.
  const handleModalConfirm = useCallback(
    (result: PostGameModalResult) => {
      if (result.nickname !== undefined) {
        setNickname(result.nickname)
      }
      if (result.leaderboardMetadata !== undefined) {
        setLeaderboardMetadata(result.leaderboardMetadata)
      }
      const confirmedNickname = result.nickname ?? nickname
      const confirmedMetadata = result.leaderboardMetadata ?? leaderboardMetadata
      if (confirmedNickname !== null && confirmedMetadata !== null && hasFinishedDailyRun) {
        setSubmitting(true)
        performSubmission(confirmedNickname, confirmedMetadata)
      }
      if (result.survey !== undefined) {
        logEvent('survey_submit', { ...result.survey })
      }
      if (needSurvey) {
        markSurveyAnswered()
      }
      setModalOpen(false)
    },
    [performSubmission, needSurvey, nickname, leaderboardMetadata, hasFinishedDailyRun]
  )

  // Survey-only dismissal. The device is marked answered so the survey does
  // not reappear, but no `survey_submit` event fires — a skip is not a
  // response.
  const handleModalSkip = useCallback(() => {
    markSurveyAnswered()
    setModalOpen(false)
  }, [])

  const handleRetrySubmit = useCallback(() => {
    if (nickname === null) return
    if (leaderboardMetadata === null) return
    setRetried(true)
    setSubmitFailed(false)
    setSubmitFailKind(null)
    setSubmitFailMessage(null)
    setSubmitting(true)
    const submission = buildSubmission(nickname, leaderboardMetadata)
    if (!submission) {
      setSubmitting(false)
      return
    }
    submitScore(submission).then((result) => applySubmitResult(submission, result))
  }, [buildSubmission, applySubmitResult, nickname, leaderboardMetadata])

  const handlePlayAgain = () => {
    // Emit BEFORE the RESET so we still capture the just-finished run's mode
    // and attempt number — after RESET those revert to INITIAL_STATE values
    // and the signal is lost.
    logEvent('replay_intent', {
      mode: state.mode,
      attemptNumber: state.attemptNumber,
    })
    dispatch({ type: 'RESET' })
    navigate(`/bombsquad/run?mode=${state.mode}`)
  }

  // No game in memory at all — distinct from a finished run that solved zero
  // modules (an exploded run, which still carries an `outcome`).
  if (noRunData) {
    return (
      <main className={styles.page}>
        <Scenery accent="yellow" />
        <div className={styles.stage}>
          <p className={styles.noData}>
            暂无数据。{' '}
            <Link to="/bombsquad" className={styles.noDataLink}>
              返回主页
            </Link>
          </p>
        </div>
      </main>
    )
  }

  const heading = variant === 'success' ? '拆弹成功' : '差一点'
  const burstGlyph: GlyphKey = variant === 'success' ? 'ji' : 'yi'
  const accentColor = variant === 'success' ? 'var(--green)' : 'var(--rose)'

  // Failure subtitle names the module the run stopped on (handoff §6.7
  // 「卡在星符」) — real data: the next un-played module in the sequence.
  const stuckKind =
    variant === 'failure' ? state.moduleSequence[state.moduleStats.length] : undefined
  const modeMeta = state.mode === 'daily' ? `每日挑战 · 第 ${state.attemptNumber} 次尝试` : '练习'
  const subtitle =
    stuckKind !== undefined ? `${modeMeta} · 卡在${MODULE_LABEL[stuckKind] ?? stuckKind}` : modeMeta

  const showRankCard = variant === 'success' && state.mode === 'daily' && outcome === 'defused'
  const showBreakdown = state.moduleStats.length > 0
  const breakdownTitle = variant === 'success' ? '模块用时' : '本局回顾'
  const okMarker = variant === 'success' ? '— —' : '✓'

  return (
    <main className={styles.page}>
      <Scenery accent={variant === 'success' ? 'green' : 'rose'} />
      <div className={styles.stage}>
        <div className={styles.result} data-variant={variant}>
          <div className={styles.burst}>
            {variant === 'success' && <span className={styles.successRing} aria-hidden="true" />}
            <Glyph
              name={burstGlyph}
              size={variant === 'success' ? 88 : 92}
              glow={false}
              color={accentColor}
              className={`${styles.burstGlyph} ${
                variant === 'success' ? styles.burstGlyphEnter : ''
              }`}
            />
          </div>

          <h1 className={styles.heading}>{heading}</h1>

          {totalMs !== null && <div className={styles.totalTime}>{formatMs(totalMs)}</div>}

          <p className={styles.subtitle}>{subtitle}</p>

          {showRankCard && (
            <div className={styles.rankCard}>
              {rankResult ? (
                <>
                  <div className={styles.rankCell}>
                    <div className={styles.rankLabel}>全球排名</div>
                    <div className={styles.rankValue}>
                      #{rankResult.rank}
                      <span className={styles.rankOf}> / {rankResult.total_players}</span>
                    </div>
                  </div>
                  {rankResult.personal_best_ms !== undefined && (
                    <div className={`${styles.rankCell} ${styles.rankCellRight}`}>
                      <div className={styles.rankLabel}>今日最佳</div>
                      <div className={styles.rankValue}>
                        {formatMs(rankResult.personal_best_ms)}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.rankCell}>
                  <div className={styles.rankPending}>
                    {leaderboardGatePending && '提交前请填写昵称和 AI 搭档'}
                    {!leaderboardGatePending && submitting && '提交成绩中…'}
                    {!leaderboardGatePending &&
                      !submitting &&
                      submitFailed &&
                      (submitFailKind === 'rejected' ? (
                        // Server reached and refused — not an offline state.
                        // Retry once for transient refusals (e.g. rate limit);
                        // a persistent rejection points the player at feedback.
                        retried ? (
                          <>
                            成绩未能通过校验，暂时无法上榜。
                            {submitFailMessage ? `（${submitFailMessage}）` : ''}
                            可邮件反馈 byheaven0912@gmail.com
                          </>
                        ) : (
                          <>
                            成绩校验未通过
                            {submitFailMessage ? `（${submitFailMessage}）` : ''}
                            <button className={styles.retryBtn} onClick={handleRetrySubmit}>
                              重试
                            </button>
                          </>
                        )
                      ) : retried ? (
                        '网络不稳定，可下次再来重新提交。或邮件反馈 byheaven0912@gmail.com'
                      ) : (
                        <>
                          提交失败（可能离线）
                          <button className={styles.retryBtn} onClick={handleRetrySubmit}>
                            重试
                          </button>
                        </>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {variant === 'failure' && (
            <div className={styles.quote}>
              <div className={styles.quoteLabel}>AI 说</div>
              <p className={styles.quoteBody}>「{consolationText(outcome, state.strikeCount)}」</p>
            </div>
          )}

          {showBreakdown && (
            <div className={styles.breakdown}>
              <div className={styles.breakdownHead}>{breakdownTitle}</div>
              {state.moduleSequence.map((kind, i) => {
                const stat = state.moduleStats[i]
                const rowState: 'done' | 'failed' | 'todo' =
                  i < state.moduleStats.length
                    ? 'done'
                    : i === state.moduleStats.length
                      ? 'failed'
                      : 'todo'
                const glyphColor =
                  rowState === 'failed'
                    ? 'var(--rose)'
                    : rowState === 'todo'
                      ? 'rgba(255, 255, 255, 0.3)'
                      : 'rgba(255, 255, 255, 0.7)'
                const statusText =
                  rowState === 'failed'
                    ? '未完成'
                    : rowState === 'todo'
                      ? '未开始'
                      : stat && stat.errorCount > 0
                        ? `${stat.errorCount} 失误`
                        : okMarker
                const rowClass = [
                  styles.bdRow,
                  rowState === 'failed' && styles.bdRowFailed,
                  rowState === 'todo' && styles.bdRowTodo,
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <div key={i} className={rowClass}>
                    <span className={styles.bdIcon}>
                      <Glyph
                        name={MODULE_GLYPH[kind] ?? 'ji'}
                        size={20}
                        glow={false}
                        color={glyphColor}
                      />
                    </span>
                    <span className={styles.bdName}>{MODULE_LABEL[kind] ?? kind}</span>
                    <span className={styles.bdTime}>{stat ? formatMs(stat.timeMs) : '— —'}</span>
                    <span className={styles.bdStatus}>{statusText}</span>
                  </div>
                )
              })}
            </div>
          )}

          <div className={styles.cta}>
            <Button variant="primary" full onClick={handlePlayAgain}>
              再来一局<span aria-hidden="true"> →</span>
            </Button>
            <Button variant="ghost" full onClick={() => navigate('/bombsquad')}>
              回主页
            </Button>
          </div>
        </div>
      </div>

      <PostGameModal
        open={modalOpen}
        showNickname={needNickname}
        showLeaderboardMetadata={needLeaderboardMetadata}
        showSurvey={needSurvey}
        onConfirm={handleModalConfirm}
        onSkip={handleModalSkip}
      />
    </main>
  )
}
