import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import PostGameModal, { type PostGameModalResult } from '@/components/PostGameModal'
import { Scenery } from '@amiclaw/ui'
import {
  markArcadeProfileEventsClaimed,
  readArcadeLocalProfile,
  recordBombSquadLocalRun,
  summarizeArcadeLocalProfile,
} from '@amiclaw/arcade-profile/local'
import type { ArcadeDailyLoopSummary } from '@amiclaw/arcade-profile/types'
import { submitArcadeProfileEvent } from '@amiclaw/arcade-profile/api-client'
import Button from '@/components/bombsquad/Button'
import Glyph, { type GlyphKey } from '@/components/bombsquad/Glyph'
import { useGame, MAX_STRIKES, type GameOutcome } from '@/store/game-context'
import { getDailyResetHint, getTodayString } from '@shared/date'
import { getDeviceId } from '@/utils/device-fingerprint'
import { logEvent } from '@/utils/event-log'
import { formatMs } from '@shared/format-time'
import { submitScore, type SubmitScoreResult } from '@shared/leaderboard-api'
import { saveOptimisticEntry } from '@shared/leaderboard-optimistic'
import { getStoredNickname } from '@/utils/nickname'
import { copyToClipboard } from '@/utils/clipboard'
import {
  getStoredLeaderboardPlayerMetadata,
  type LeaderboardPlayerMetadata,
} from '@/utils/leaderboard-player-metadata'
import { hasAnsweredSurvey, markSurveyAnswered } from '@/utils/survey'
import { readEntryRecoveryState } from '@/utils/session'
import { wasClosingRecapFired } from '@/voice/closing-recap-log'
import { useCompanionPartner } from '@/hooks/useCompanionPartner'
import {
  readBeatLog,
  readCachedVoicePosture,
  recordBeatFired,
  writeBeatLog,
} from '@shared/companion-presence'
import { deriveCompanionReaction } from './companion-reaction'
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

const RESULT_FEEDBACK_SURVEY_DELAY_MS = 1800
// A practice win has no rank reveal to settle behind (#209 defers the daily
// survey until the rank card lands). Its celebration beat is the win payoff
// itself — the success ring + glyph pop + time + companion reaction — so the
// survey waits a longer, celebration-length window before opening, instead of
// snapping up over the payoff a beat after mount (audit F11).
const RESULT_PRACTICE_CELEBRATION_MS = 4200

/** The result screen has two visual variants (handoff README §6.6 / §6.7). */
type ResultVariant = 'success' | 'failure'
type PostGameModalPurpose = 'leaderboard' | 'survey'
type ProfileSaveState = 'idle' | 'saved-local' | 'synced' | 'account-error' | 'unavailable'
// `manual` is the terminal fallback: neither the Web Share API nor the
// clipboard was usable, so the share text is surfaced in a selectable field for
// the player to copy by hand. No path dead-ends in a bare 「分享失败」.
type ShareState = 'idle' | 'shared' | 'copied' | 'manual'

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
  const [entryRecovery] = useState(() => readEntryRecoveryState())
  const [profileSaveState, setProfileSaveState] = useState<ProfileSaveState>('idle')
  const [dailyLoop, setDailyLoop] = useState<ArcadeDailyLoopSummary | null>(null)
  const [shareState, setShareState] = useState<ShareState>('idle')
  // Holds the share text for the terminal select-and-copy fallback (`manual`).
  const [shareText, setShareText] = useState('')

  // Fall back to `defused` for any legacy RESULT state persisted before the
  // game-modes rework added the `outcome` field.
  const outcome: GameOutcome = state.outcome ?? 'defused'
  const variant = resultVariant(outcome)

  // True only when ResultPage was opened with no run in memory at all (distinct
  // from a finished run that solved zero modules — that still carries an
  // outcome). Gates both the no-run recovery state and the success payoff below.
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

  // --- Companion post-game reaction (节拍 3, mode② settlements only) ----------
  // Template-filled from the run's real facts (companion-presence-design
  // register: factual, relaxed on a clear, never consoling). Computed once in
  // the initializer (pure — no writes); the beat-log recording side effect
  // lives in the mount effect below, which is StrictMode/refresh idempotent
  // via the per-run `lastPostGameRunId` dedupe. A quiet/denied remembered
  // posture freezes all proactive beats, this one included. The posture read
  // is cache-first by design; the cache refreshes on every companion identity
  // read (the connect-page co-play gate and this page's partner read both
  // sync it via useCompanionPartner), so a cross-device mute can lag at most
  // one settlement on a deep-linked run — an accepted cache-first trade-off.
  const companionRunId = entryRecovery?.platformPartner === true ? state.gameRunId : null
  const [companionReaction] = useState<string | null>(() =>
    // Pure gate (both dedup directions + beat caps in `deriveCompanionReaction`);
    // the impure reads (posture cache, beat log, closing-recap dedup flag) happen
    // here and are passed in.
    deriveCompanionReaction({
      noRunData,
      companionRunId,
      outcome: state.outcome,
      // Dedup — one recap, not two: if the SPOKEN closing recap already fired for
      // this run, the settlement is recapped by voice; suppress the text reaction.
      recapAlreadyFired: wasClosingRecapFired(companionRunId),
      posture: readCachedVoicePosture(),
      log: readBeatLog(getTodayString()),
      reactionFacts: {
        outcome: state.outcome ?? 'defused',
        durationMs: totalMs,
        moduleCount: state.moduleSequence.length,
        completedModules: state.moduleStats.length,
        strikeCount: state.strikeCount,
      },
    })
  )
  // The companion identity read powers the speaker label; a failed read keeps
  // the line with the generic label rather than dropping the reaction.
  const companionPartner = useCompanionPartner(companionReaction !== null)
  useEffect(() => {
    if (companionReaction === null || companionRunId === null) return
    const log = readBeatLog(getTodayString())
    if (log.lastPostGameRunId !== companionRunId) {
      writeBeatLog(recordBeatFired(log, { kind: 'post-game', gameRunId: companionRunId }))
    }
    // Mount-once recording; the dedupe above absorbs StrictMode's double run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (noRunData) return
    if (totalMs === null || state.gameRunId === null || state.outcome === null) return
    const event = recordBombSquadLocalRun({
      runId: state.gameRunId,
      mode: state.mode,
      outcome: state.outcome,
      durationMs: totalMs,
      attemptNumber: state.attemptNumber,
      moduleCount: state.moduleSequence.length,
      completedModules: state.moduleStats.length,
      strikeCount: state.strikeCount,
      finishedAt: new Date(state.totalEndTime ?? Date.now()).toISOString(),
    })
    if (event) {
      if (event.kind !== 'bombsquad_run') {
        queueMicrotask(() => setProfileSaveState('unavailable'))
        return
      }
      const sourceKey = event.run.source_key
      const localProfile = readArcadeLocalProfile()
      const localSaved =
        localProfile?.bombsquad_runs.some((run) => run.source_key === sourceKey) ?? false
      const localDailyLoop = localSaved
        ? summarizeArcadeLocalProfile(localProfile).daily_loop
        : null
      queueMicrotask(() => {
        setProfileSaveState(localSaved ? 'saved-local' : 'unavailable')
        if (localDailyLoop) setDailyLoop(localDailyLoop)
      })
      submitArcadeProfileEvent(event).then((result) => {
        if (result.kind === 'ok') {
          markArcadeProfileEventsClaimed([sourceKey])
          setProfileSaveState('synced')
          setDailyLoop(result.profile.daily_loop)
        } else if (result.kind === 'anon') {
          setProfileSaveState(localSaved ? 'saved-local' : 'unavailable')
        } else {
          setProfileSaveState(localSaved ? 'account-error' : 'unavailable')
        }
      })
    } else {
      queueMicrotask(() => setProfileSaveState('unavailable'))
    }
  }, [
    noRunData,
    totalMs,
    state.gameRunId,
    state.outcome,
    state.mode,
    state.attemptNumber,
    state.moduleSequence.length,
    state.moduleStats.length,
    state.strikeCount,
    state.totalEndTime,
  ])

  // Daily mode submits a score — but only on a successful defuse. An
  // exploded run never submits and never asks for a nickname. Practice mode
  // never submits in any case.
  const hasFinishedDailyRun =
    state.mode === 'daily' &&
    outcome === 'defused' &&
    totalMs !== null &&
    state.moduleStats.length > 0 &&
    state.gameRunId !== null

  // Lazy initializers: read the stored nickname once on mount. Subsequent
  // useState calls reuse the captured value so the pieces of mount
  // state stay consistent without triple-reading localStorage.
  const [nickname, setNickname] = useState<string | null>(() => getStoredNickname())
  const [leaderboardMetadata, setLeaderboardMetadata] = useState<LeaderboardPlayerMetadata | null>(
    () => getStoredLeaderboardPlayerMetadata()
  )

  // The post-game modal has two separate purposes. The leaderboard gate NEVER
  // auto-opens (audit F1): the celebration and rank reveal own the first beat,
  // and the rank card's 上榜 CTA opens the gate on demand — skippable, and
  // re-openable later from the same card (deferred fill). The once-per-device
  // survey waits until the celebration beat has settled, so it can never stack
  // over the rank reveal.
  const [needNickname] = useState(() => hasFinishedDailyRun && nickname === null)
  const [needLeaderboardMetadata] = useState(
    () => hasFinishedDailyRun && leaderboardMetadata === null
  )
  const [needSurvey] = useState(() => !hasAnsweredSurvey())
  const [leaderboardGateOpen, setLeaderboardGateOpen] = useState(false)
  // Live, not mount-frozen: flips false the moment a confirm stores both
  // values, which swaps the rank card's CTA for the submitting → rank states.
  const needsSubmissionInput =
    hasFinishedDailyRun && (nickname === null || leaderboardMetadata === null)
  const [surveyReady, setSurveyReady] = useState(false)
  const [surveyRetired, setSurveyRetired] = useState(false)
  // A server rejection notice (成绩校验未通过) is rendered inline in the rank card
  // and must be readable before the once-per-device survey opens over it — the
  // same stacking guard as #209 deferring the survey behind the rank reveal
  // (F8). A network failure is deliberately NOT gated: it invites an immediate
  // retry and carries no board verdict the player must absorb first.
  const rejectionShowing = submitFailed && submitFailKind === 'rejected'
  const surveyOpen =
    needSurvey && !surveyRetired && surveyReady && !leaderboardGateOpen && !rejectionShowing
  const modalPurpose: PostGameModalPurpose | null = leaderboardGateOpen
    ? 'leaderboard'
    : surveyOpen
      ? 'survey'
      : null
  const modalOpen = modalPurpose !== null
  // Initialize submitting=true only when the effect below will actually fire a
  // request, so we avoid a synchronous setState in the effect body
  // (react-hooks/set-state-in-effect). First-visit daily runs wait for the
  // modal confirmation before flipping submitting=true.
  const [submitting, setSubmitting] = useState(
    () => hasFinishedDailyRun && nickname !== null && leaderboardMetadata !== null
  )

  // Idempotency latch: prevents the same run from being submitted more than
  // once within a single ResultPage lifecycle. Guards all three submit paths
  // (mount effect, modal-confirm, retry). The latch is released back to 'idle'
  // on a network failure so the retry button can fire a second attempt.
  // Across remounts (e.g. page refresh with game state still in sessionStorage),
  // the per-run stable run_id in buildSubmission + backend dedup provide the
  // second layer of protection.
  const submittedRef = useRef<'idle' | 'in-flight' | 'done'>('idle')

  // The survey delay counts from when the celebration beat settles, not from
  // mount (audit F13): a daily defused run settles when its rank outcome
  // arrives (rank revealed, or the submission failed); any other run settles
  // on mount. A first win whose leaderboard gate stays unfilled never settles
  // this session — the once-per-device survey simply waits for a later one.
  const celebrationSettled = !hasFinishedDailyRun || rankResult !== null || submitFailed
  // A practice WIN settles on mount (no rank), so it uses the longer celebration
  // window to let the win payoff land first (audit F11); a daily win already
  // waited for its rank reveal, and any failure has no celebration to protect —
  // both keep the base delay.
  const surveyDelayMs =
    variant === 'success' && !hasFinishedDailyRun
      ? RESULT_PRACTICE_CELEBRATION_MS
      : RESULT_FEEDBACK_SURVEY_DELAY_MS
  useEffect(() => {
    if (!needSurvey || noRunData || !celebrationSettled) return
    const id = setTimeout(() => setSurveyReady(true), surveyDelayMs)
    return () => clearTimeout(id)
  }, [needSurvey, noRunData, celebrationSettled, surveyDelayMs])

  const buildSubmission = useCallback(
    (nicknameValue: string, metadataValue: LeaderboardPlayerMetadata): ScoreSubmission | null => {
      if (totalMs === null) return null
      if (state.gameRunId === null) return null
      const date = getTodayString()
      return {
        date,
        nickname: nicknameValue,
        time_ms: Math.round(totalMs),
        attempt_number: state.attemptNumber,
        module_times: state.moduleStats.map((s) => Math.round(s.timeMs)),
        operations_hash: 'mvp-placeholder', // temporary placeholder until real run hashing is implemented
        ai_tool: metadataValue.aiTool,
        ...(metadataValue.aiModel ? { ai_model: metadataValue.aiModel } : {}),
        device_id: getDeviceId(),
        run_id: state.gameRunId,
      }
    },
    [totalMs, state.attemptNumber, state.gameRunId, state.moduleStats]
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
  // Also manages the idempotency latch: locks it permanently on success so no
  // further submit can fire; releases it to 'idle' on failure so retry works.
  const applySubmitResult = useCallback(
    (submission: ScoreSubmission, result: SubmitScoreResult) => {
      setSubmitting(false)
      if (result.ok) {
        submittedRef.current = 'done' // permanently lock — this run is on the board
        setSubmitFailed(false)
        setSubmitFailKind(null)
        setSubmitFailMessage(null)
        setRankResult(result.data)
        // The board keeps one row per player — the day's best. Only seed an
        // optimistic entry when this run IS the personal best; a slower retry
        // never appears on the board, so an optimistic copy of it would show
        // the player a phantom second row next to their real best.
        if (
          result.data.personal_best_ms === undefined ||
          submission.time_ms <= result.data.personal_best_ms
        ) {
          recordOptimistic(submission, result.data)
        }
        try {
          sessionStorage.removeItem(`pending-score:${submission.date}`)
        } catch {
          /* ignore */
        }
      } else {
        submittedRef.current = 'idle' // release latch so the retry button can fire
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
  //
  // Idempotency: the submittedRef latch guards against concurrent or double
  // invocations within a single component lifecycle (e.g. React StrictMode
  // double-effect invocation). A cross-mount double (page refresh) is handled
  // by the stable run_id in buildSubmission + backend dedup.
  const performSubmission = useCallback(
    (nicknameValue: string, metadataValue: LeaderboardPlayerMetadata) => {
      if (submittedRef.current !== 'idle') return // already in-flight or done
      submittedRef.current = 'in-flight'

      const submission = buildSubmission(nicknameValue, metadataValue)
      if (!submission) {
        submittedRef.current = 'idle' // release if build failed (totalMs unavailable)
        return
      }

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
      const completingSurvey = modalPurpose === 'survey'
      if (completingSurvey && result.survey !== undefined) {
        logEvent('survey_submit', { ...result.survey })
      }
      if (completingSurvey && needSurvey) {
        markSurveyAnswered()
        setSurveyRetired(true)
      }
      if (modalPurpose === 'leaderboard') {
        setLeaderboardGateOpen(false)
      }
    },
    [
      performSubmission,
      needSurvey,
      nickname,
      leaderboardMetadata,
      hasFinishedDailyRun,
      modalPurpose,
    ]
  )

  // Survey-only dismissal. The device is marked answered so the survey does
  // not reappear, but no `survey_submit` event fires — a skip is not a
  // response.
  const handleModalSkip = useCallback(() => {
    if (modalPurpose === 'survey') {
      markSurveyAnswered()
      setSurveyRetired(true)
    }
    if (modalPurpose === 'leaderboard') {
      setLeaderboardGateOpen(false)
    }
  }, [modalPurpose])

  const handleRetrySubmit = useCallback(() => {
    if (nickname === null) return
    if (leaderboardMetadata === null) return
    setRetried(true)
    setSubmitFailed(false)
    setSubmitFailKind(null)
    setSubmitFailMessage(null)
    setSubmitting(true)
    // applySubmitResult resets submittedRef to 'idle' on failure, so
    // performSubmission will proceed here on the retry path.
    performSubmission(nickname, leaderboardMetadata)
  }, [performSubmission, nickname, leaderboardMetadata])

  const buildShareText = useCallback(() => {
    const time = totalMs !== null ? formatMs(totalMs) : '一局'
    const mode = state.mode === 'daily' ? 'BombSquad 每日挑战' : 'BombSquad 练习'
    const result = variant === 'success' ? '完成' : '差一点'
    const streak =
      state.mode === 'daily' && outcome === 'defused' && dailyLoop
        ? ` · 连续 ${dailyLoop.streak.current_days} 天`
        : ''
    return `${mode} ${result}：${time}${streak}。来 AMIO 游乐场一起玩：${window.location.origin}/bombsquad/`
  }, [dailyLoop, outcome, state.mode, totalMs, variant])

  // Robust share with graceful degradation (audit F26 — 真机分享失败). No path
  // dead-ends in a bare failure message:
  //   1. Web Share API when present. A user-canceled share (AbortError) is
  //      NOT a failure — leave the state untouched so no error copy shows.
  //      Any real share error falls through to the clipboard path.
  //   2. Clipboard copy (navigator.clipboard, then legacy execCommand via the
  //      shared `copyToClipboard`) with explicit success feedback.
  //   3. Terminal fallback: surface the text in a selectable field to copy by
  //      hand — never a bare 「分享失败」.
  const handleShareResult = useCallback(async () => {
    const text = buildShareText()
    const share = (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share
    if (share) {
      try {
        await share({
          title: 'AMIO Arcade BombSquad',
          text,
          url: `${window.location.origin}/bombsquad/`,
        })
        setShareState('shared')
        return
      } catch (err) {
        // User dismissed the native share sheet — a deliberate cancel, not a
        // failure. Stay silent rather than nagging with an error line.
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Any other share failure (real-device NotAllowedError etc.) falls
        // through to the clipboard path below.
      }
    }
    if (await copyToClipboard(text)) {
      setShareState('copied')
      return
    }
    // Clipboard blocked too — reveal the text for manual selection.
    setShareText(text)
    setShareState('manual')
  }, [buildShareText])

  const handlePlayAgain = () => {
    // Emit BEFORE the RESET so we still capture the just-finished run's mode
    // and attempt number — after RESET those revert to INITIAL_STATE values
    // and the signal is lost.
    logEvent('replay_intent', {
      mode: state.mode,
      attemptNumber: state.attemptNumber,
    })
    dispatch({ type: 'RESET' })
    // A mode② run replays as mode②: the player never handed a manual to their
    // own AI, so dropping the partner param would strand the next run in mode①
    // with no partner connected at all.
    const partnerParam =
      state.mode === 'daily' && entryRecovery?.platformPartner === true ? '&partner=platform' : ''
    navigate(`/bombsquad/run?mode=${state.mode}${partnerParam}`)
  }

  // No game in memory at all — distinct from a finished run that solved zero
  // modules (an exploded run, which still carries an `outcome`). Reached when
  // the result page is opened with no live run: a direct link to
  // /bombsquad/result, a refresh that cleared the run context, or an odd
  // back-navigation. Recover from the last selected entry mode when available.
  // If the player already completed the connect-page handoff, the primary CTA
  // returns directly to the matching run; otherwise it goes back through the
  // connect flow and explains why the manual step is still required.
  if (noRunData) {
    const recoveryMode = entryRecovery?.mode ?? 'daily'
    const manualHandoffComplete = entryRecovery?.manualHandoffComplete === true
    const recoveryPartner = entryRecovery?.platformPartner === true ? '&partner=platform' : ''
    const recoveryRunTarget =
      recoveryMode === 'daily'
        ? `/bombsquad/run?mode=daily${
            entryRecovery?.manualUrl ? `&url=${encodeURIComponent(entryRecovery.manualUrl)}` : ''
          }${recoveryPartner}`
        : '/bombsquad/run?mode=practice'
    const recoveryConnectTarget = `/bombsquad/connect?mode=${recoveryMode}`
    const recoveryTitle =
      recoveryMode === 'practice'
        ? '重新进入练习'
        : manualHandoffComplete
          ? '重新进入每日挑战'
          : '重新开始一局'
    const recoveryText =
      recoveryMode === 'practice'
        ? manualHandoffComplete
          ? '这里没有正在结算的练习关卡。手册对接已经完成，可以直接重新进入练习。'
          : '这里没有正在结算的练习关卡。先把练习手册交给 AI，等它读完，再进入练习。'
        : manualHandoffComplete
          ? '手册对接已经完成，但这一局还没真正开始。可以直接重新进入每日挑战；如果 AI 没读完，再回到对接页。'
          : '这里没有正在结算的关卡。先把手册交给 AI，等它读完，再进入每日挑战。'
    const primaryLabel =
      recoveryMode === 'practice'
        ? manualHandoffComplete
          ? '直接进入练习'
          : '先交练习手册，再开始'
        : manualHandoffComplete
          ? '直接进入每日挑战'
          : '先交手册，再开始每日挑战'
    const secondaryAction = manualHandoffComplete
      ? { label: '重新对接手册', target: recoveryConnectTarget }
      : recoveryMode === 'daily'
        ? { label: '练习一局', target: '/bombsquad/connect?mode=practice' }
        : null

    return (
      <main className={styles.page}>
        <Scenery accent="yellow" />
        <div className={styles.stage}>
          <div className={styles.noData}>
            <h1 className={styles.noDataTitle}>{recoveryTitle}</h1>
            <p className={styles.noDataText}>{recoveryText}</p>
            <div className={styles.cta}>
              <Button
                variant="primary"
                full
                onClick={() =>
                  navigate(manualHandoffComplete ? recoveryRunTarget : recoveryConnectTarget)
                }
              >
                {primaryLabel}
                <span aria-hidden="true"> →</span>
              </Button>
              {secondaryAction && (
                <Button variant="ghost" full onClick={() => navigate(secondaryAction.target)}>
                  {secondaryAction.label}
                </Button>
              )}
              <Button variant="ghost" full onClick={() => navigate('/bombsquad')}>
                返回主页
              </Button>
            </div>
          </div>
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
  const showDailyLoopCard = totalMs !== null && state.gameRunId !== null
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

          {companionReaction !== null && (
            <div className={styles.companionReaction} role="status" aria-label="伙伴的反应">
              <span className={styles.companionReactionName}>
                {companionPartner.status === 'available' ? companionPartner.name : '伙伴'}
              </span>
              <span className={styles.companionReactionText}>{companionReaction}</span>
            </div>
          )}

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
                    {needsSubmissionInput && (
                      // Honest not-on-board state (audit F1): the run is NOT
                      // on the leaderboard until the player fills the gate.
                      // The CTA re-opens the modal at any time — the deferred
                      // fill path after a skip.
                      <>
                        这局成绩还没上榜。填写昵称和 AI 搭档后，即可上榜并查看全球排名。
                        <button
                          className={styles.boardCta}
                          onClick={() => setLeaderboardGateOpen(true)}
                        >
                          填写并上榜
                        </button>
                      </>
                    )}
                    {!needsSubmissionInput && submitting && '提交成绩中…'}
                    {!needsSubmissionInput &&
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

          {showDailyLoopCard && (
            <div className={styles.loopCard}>
              <div>
                <div className={styles.loopLabel}>我的档案</div>
                <div className={styles.loopTitle}>{profileSaveText(profileSaveState)}</div>
                <p className={styles.loopText}>
                  {state.mode === 'daily' &&
                  outcome === 'defused' &&
                  dailyLoop?.streak.today_completed
                    ? `今日已打卡 · 连续 ${dailyLoop.streak.current_days} 天 · 最长 ${dailyLoop.streak.longest_days} 天`
                    : state.mode === 'daily' && outcome === 'defused'
                      ? '本局已保存；连续打卡状态以今日活动为准。'
                      : '本局已保存；练习、失败和超时不计入连续打卡。'}
                </p>
                {shareState !== 'idle' && shareState !== 'manual' && (
                  <p className={styles.shareStatus}>{shareStatusText(shareState)}</p>
                )}
                {shareState === 'manual' && (
                  <div className={styles.shareManual}>
                    <p className={styles.shareStatus}>
                      这台设备不支持一键分享，长按下面的文字复制：
                    </p>
                    <textarea
                      className={styles.shareManualText}
                      readOnly
                      rows={3}
                      value={shareText}
                      aria-label="分享文案"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </div>
                )}
                <p className={styles.loopHint}>{getDailyResetHint()}</p>
              </div>
              <div className={styles.loopActions}>
                <button type="button" className={styles.loopAction} onClick={handleShareResult}>
                  分享今日成绩
                </button>
                <button
                  type="button"
                  className={styles.loopAction}
                  onClick={() => window.location.assign('/leaderboard')}
                >
                  查看排行榜
                </button>
                <button
                  type="button"
                  className={styles.loopAction}
                  onClick={() => window.location.assign('/me')}
                >
                  保存到我的档案
                </button>
              </div>
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
        showNickname={modalPurpose === 'leaderboard' && needNickname}
        showLeaderboardMetadata={modalPurpose === 'leaderboard' && needLeaderboardMetadata}
        showSurvey={modalPurpose === 'survey' && needSurvey}
        onConfirm={handleModalConfirm}
        onSkip={handleModalSkip}
      />
    </main>
  )
}

function profileSaveText(state: ProfileSaveState): string {
  switch (state) {
    case 'synced':
      return '已保存到账号档案'
    case 'saved-local':
      return '已保存到本设备'
    case 'account-error':
      return '本设备已保存，账号同步失败'
    case 'unavailable':
      return '本局暂未写入档案'
    default:
      return '保存中…'
  }
}

function shareStatusText(state: ShareState): string {
  switch (state) {
    case 'shared':
      return '已打开系统分享。'
    case 'copied':
      return '分享文案已复制。'
    default:
      return ''
  }
}
