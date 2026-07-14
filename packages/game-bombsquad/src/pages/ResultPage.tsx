import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import PostGameModal from '@/components/PostGameModal'
import { AI_TOOLS, Button, COMPANION_TOOL_ID, Disclosure, Scenery } from '@amiclaw/ui'
import {
  markArcadeProfileEventsClaimed,
  readArcadeLocalProfile,
  recordBombSquadLocalRun,
  summarizeArcadeLocalProfile,
} from '@amiclaw/arcade-profile/local'
import type { ArcadeDailyLoopSummary } from '@amiclaw/arcade-profile/types'
import { fetchArcadeProfile, submitArcadeProfileEvent } from '@amiclaw/arcade-profile/api-client'
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
  setStoredLeaderboardPlayerMetadata,
  type LeaderboardPlayerMetadata,
} from '@/utils/leaderboard-player-metadata'
import { hasAnsweredSurvey, markSurveyAnswered } from '@/utils/survey'
import { readSubmittedRun, writeSubmittedRun } from '@/utils/submitted-run'
import { readEntryRecoveryState } from '@/utils/session'
import { wasClosingRecapFired } from '@/voice/closing-recap-log'
import { useCompanionPartner } from '@/hooks/useCompanionPartner'
import type { SurveyAnswers } from '@shared/event-types'
import {
  readBeatLog,
  readCachedVoicePosture,
  recordBeatFired,
  writeBeatLog,
} from '@shared/companion-presence'
import { deriveCompanionReaction } from './companion-reaction'
import { playSfx } from '@/audio/useSfx'
import type { ScoreSubmission, ScoreSubmissionResponse } from '@shared/leaderboard-types'
import { STARBURST_GLYPH, STARBURST_LABEL } from '@shared/reward-types'
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
// survey waits a longer, celebration-length window before folding in, instead of
// appearing a beat after mount (audit F11).
const RESULT_PRACTICE_CELEBRATION_MS = 4200

/** The result screen has two visual variants (handoff README §6.6 / §6.7). */
type ResultVariant = 'success' | 'failure'
type ProfileSaveState = 'idle' | 'saved-local' | 'synced' | 'account-error' | 'unavailable'
// `manual` is the terminal fallback: neither the Web Share API nor the
// clipboard was usable, so the share text is surfaced in a selectable field for
// the player to copy by hand. No path dead-ends in a bare 「分享失败」.
type ShareState = 'idle' | 'shared' | 'copied' | 'manual'

/**
 * Who this settlement is submitting as. Resolved once, asynchronously, for a
 * won daily run:
 *  - `signed-in`  → an account with a resolvable username; the run auto-submits
 *    under it, no user action (ruling B).
 *  - `need-name`  → signed in but no public label and no device nickname yet;
 *    the player sets a name in /me to appear on the board.
 *  - `anon`       → not signed in (or the profile read failed); ONE calm login
 *    invite, and the run only goes on the board if they log in. The anonymous
 *    free-nickname submission flow is retired.
 */
type SettlementIdentity =
  | { status: 'resolving' }
  | { status: 'signed-in'; username: string }
  | { status: 'need-name' }
  | { status: 'anon' }

/**
 * The leaderboard `ai_tool`, resolved inference-first for a signed-in
 * auto-submit (ruling B):
 *  - `ready` → inferred from a companion co-play (mode②) run, or reused from a
 *    prior device choice; submitted with no ask.
 *  - `ask`   → not inferable and no stored choice; the settlement shows one
 *    inline row of SSOT chips, picked once and remembered.
 */
type AiToolResolution = { kind: 'ready'; aiTool: string; aiModel?: string } | { kind: 'ask' }

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

/** Resolve the leaderboard AI-tool inference-first for the current run. Pure —
 *  reads localStorage + the frozen entry-recovery state, no writes. */
function resolveAiTool(platformPartner: boolean): AiToolResolution {
  // A run played with the platform companion's voice connected (mode②) tags as
  // the companion — a per-run inference, never written back to the device's BYO
  // tool choice.
  if (platformPartner) return { kind: 'ready', aiTool: COMPANION_TOOL_ID }
  const stored = getStoredLeaderboardPlayerMetadata()
  if (stored) {
    return stored.aiModel
      ? { kind: 'ready', aiTool: stored.aiTool, aiModel: stored.aiModel }
      : { kind: 'ready', aiTool: stored.aiTool }
  }
  return { kind: 'ask' }
}

export default function ResultPage() {
  const navigate = useNavigate()
  const { state, dispatch } = useGame()
  // Restore the earned rank on a reload / navigate-back within the backend's 10s
  // device rate-limit window (F1): the RESULT state is persisted, so without
  // this the auto-submit effect would re-POST, hit the 429 rate limit, and
  // replace the just-earned rank with a false failure. The per-run marker lets
  // the settlement re-render the rank instead of re-submitting.
  const [rankResult, setRankResult] = useState<ScoreSubmissionResponse | null>(() => {
    const submitted = readSubmittedRun()
    return submitted && submitted.runId === state.gameRunId ? submitted.response : null
  })
  const [submitFailed, setSubmitFailed] = useState(false)
  const [retried, setRetried] = useState(false)
  // Distinguishes a server-side validation rejection from a network failure so
  // the failure copy can be honest. `null` while no failure is showing.
  const [submitFailKind, setSubmitFailKind] = useState<'network' | 'rejected' | null>(null)
  // The rejection's HTTP status drives a fully-localized Chinese reason (F2):
  // 429 = rate limit, anything else (422 plausibility floor / structural) reads
  // as「成绩未通过合理性校验」. The server's raw English `error` string is never
  // shown — it would leak the exact 60s threshold to a would-be forger and mix
  // English into the Chinese product. `null` while no failure is showing.
  const [submitFailStatus, setSubmitFailStatus] = useState<number | null>(null)
  const [entryRecovery] = useState(() => readEntryRecoveryState())
  const [profileSaveState, setProfileSaveState] = useState<ProfileSaveState>('idle')
  const [dailyLoop, setDailyLoop] = useState<ArcadeDailyLoopSummary | null>(null)
  // The +3 check-in reward beat (reward-economy §4), set only when the profile
  // event POST reports the day's FIRST qualified activity credited. Drives the
  // fx + sfx cue — visual/audio only, never a companion-voice line.
  const [checkinCredited, setCheckinCredited] = useState<{ amount: number } | null>(null)
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
          // The day's first qualified activity banked the +3 check-in reward:
          // play the fx + sfx beat. `playSfx` is a no-op while the mode② voice
          // partner is live (its own gate), so it never talks over the AI.
          if (result.checkinReward?.credited) {
            setCheckinCredited({ amount: result.checkinReward.amount })
            playSfx('reward-checkin')
          }
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
  // exploded run never submits and never asks for anything. Practice mode
  // never submits in any case.
  const hasFinishedDailyRun =
    state.mode === 'daily' &&
    outcome === 'defused' &&
    totalMs !== null &&
    state.moduleStats.length > 0 &&
    state.gameRunId !== null

  // Inference-first AI-tool resolution, frozen on mount (pure read).
  const [aiToolResolution] = useState<AiToolResolution>(() =>
    resolveAiTool(entryRecovery?.platformPartner === true)
  )
  // The chip picked from the inline ask, if any — remembered for next time.
  const [pickedAiTool, setPickedAiTool] = useState<string | null>(null)

  // Concrete metadata to submit once identity is known: the inferred/stored
  // value, or the chip the player just picked. `null` means we still need the
  // inline chips ask.
  const resolvedMetadata: LeaderboardPlayerMetadata | null =
    aiToolResolution.kind === 'ready'
      ? aiToolResolution.aiModel
        ? { aiTool: aiToolResolution.aiTool, aiModel: aiToolResolution.aiModel }
        : { aiTool: aiToolResolution.aiTool }
      : pickedAiTool
        ? { aiTool: pickedAiTool }
        : null

  const [identity, setIdentity] = useState<SettlementIdentity>(() =>
    hasFinishedDailyRun ? { status: 'resolving' } : { status: 'anon' }
  )
  const [submitting, setSubmitting] = useState(false)

  // Idempotency latch: prevents the same run from being submitted more than
  // once within a single ResultPage lifecycle. Guards every submit path
  // (auto-submit, chip-pick, retry). The latch is released back to 'idle' on a
  // network failure so the retry button can fire a second attempt. Across
  // remounts (page refresh) the per-run stable run_id + backend dedup provide a
  // second layer of protection. When the rank was restored from the submitted
  // marker on mount (F1), the latch starts 'done' so the auto-submit effect
  // never re-POSTs the already-boarded run.
  const submittedRef = useRef<'idle' | 'in-flight' | 'done'>(rankResult !== null ? 'done' : 'idle')
  // The last submitted identity + metadata, so the retry button can re-fire.
  const lastSubmitRef = useRef<{ username: string; metadata: LeaderboardPlayerMetadata } | null>(
    null
  )

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
  // (success / network failure / server rejection) so every submit path stays
  // in lockstep. Also manages the idempotency latch: locks it permanently on
  // success so no further submit can fire; releases it to 'idle' on failure so
  // retry works.
  const applySubmitResult = useCallback(
    (submission: ScoreSubmission, result: SubmitScoreResult) => {
      setSubmitting(false)
      if (result.ok) {
        submittedRef.current = 'done' // permanently lock — this run is on the board
        setSubmitFailed(false)
        setSubmitFailKind(null)
        setSubmitFailStatus(null)
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
        // Persist the earned rank keyed by run_id so a reload within the 10s
        // rate-limit window re-renders it instead of re-POSTing (F1).
        if (submission.run_id) writeSubmittedRun(submission.run_id, result.data)
        return
      }
      // A rejection for a run already known to be on the board is not a real
      // failure (F1): the common case is a 429 from the backend's 10s device
      // rate-limit after a reload re-fired the auto-submit. Re-render the earned
      // rank instead of the false「提交太频繁 / 提交失败」copy.
      const boarded = submission.run_id ? readSubmittedRun() : null
      if (boarded && boarded.runId === submission.run_id) {
        submittedRef.current = 'done'
        setSubmitFailed(false)
        setSubmitFailKind(null)
        setSubmitFailStatus(null)
        setRankResult(boarded.response)
        return
      }
      submittedRef.current = 'idle' // release latch so the retry button can fire
      setSubmitFailed(true)
      setSubmitFailKind(result.kind)
      setSubmitFailStatus(result.kind === 'rejected' ? result.status : null)
    },
    [recordOptimistic]
  )

  // Fires the actual submission. Callers own the `setSubmitting(true)` toggle so
  // this stays callable from an async continuation without tripping
  // react-hooks/set-state-in-effect. Idempotency: the submittedRef latch guards
  // against concurrent or double invocations within one component lifecycle.
  const performSubmission = useCallback(
    (username: string, metadata: LeaderboardPlayerMetadata) => {
      if (submittedRef.current !== 'idle') return // already in-flight or done
      submittedRef.current = 'in-flight'
      lastSubmitRef.current = { username, metadata }

      const submission = buildSubmission(username, metadata)
      if (!submission) {
        submittedRef.current = 'idle' // release if build failed (totalMs unavailable)
        return
      }

      submitScore(submission).then((result) => applySubmitResult(submission, result))
    },
    [buildSubmission, applySubmitResult]
  )

  // Resolve identity once for a won daily run and, when it lands signed-in with
  // an inferred/stored tool, auto-submit with no user action (ruling B). The
  // setState lives inside the async `.then`, so it does not trip
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!hasFinishedDailyRun) return
    // Rank already restored from the submitted marker on a reload / navigate-back
    // (F1): the run is on the board, so skip the profile fetch and the re-POST
    // that the 10s device rate-limit would reject.
    if (submittedRef.current === 'done') return
    let active = true
    fetchArcadeProfile().then((result) => {
      if (!active) return
      if (result.kind !== 'ok') {
        setIdentity({ status: 'anon' })
        return
      }
      const username = result.publicProfile.public_label ?? getStoredNickname()
      if (!username) {
        setIdentity({ status: 'need-name' })
        return
      }
      setIdentity({ status: 'signed-in', username })
      if (aiToolResolution.kind === 'ready') {
        setSubmitting(true)
        performSubmission(username, {
          aiTool: aiToolResolution.aiTool,
          ...(aiToolResolution.aiModel ? { aiModel: aiToolResolution.aiModel } : {}),
        })
      }
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The player picks their AI tool from the inline chips (first-time BYO run,
  // nothing inferable / stored). One tap remembers the choice and submits.
  const handlePickAiTool = useCallback(
    (toolId: string) => {
      if (identity.status !== 'signed-in') return
      // Lock on the first tap: a rapid second tap of a different chip must not
      // overwrite the stored tool while the first tap's submission is already in
      // flight — otherwise the board records tool A (first tap, guarded by the
      // latch) while the device remembers tool B (F4). Gating the storage write
      // on the same latch keeps the submitted and remembered tool identical.
      if (submittedRef.current !== 'idle') return
      const metadata: LeaderboardPlayerMetadata = { aiTool: toolId }
      setStoredLeaderboardPlayerMetadata(metadata)
      setPickedAiTool(toolId)
      setSubmitting(true)
      performSubmission(identity.username, metadata)
    },
    [identity, performSubmission]
  )

  const handleRetrySubmit = useCallback(() => {
    const last = lastSubmitRef.current
    if (!last) return
    setRetried(true)
    setSubmitFailed(false)
    setSubmitFailKind(null)
    setSubmitFailStatus(null)
    setSubmitting(true)
    // applySubmitResult reset submittedRef to 'idle' on failure, so
    // performSubmission proceeds here on the retry path.
    performSubmission(last.username, last.metadata)
  }, [performSubmission])

  // --- Endgame survey (once per device, fold-in entry — audit U13) -----------
  // The survey is never an auto-opening modal: it appears as a calm inline
  // 「聊聊这一局」entry AFTER the settlement has settled, and only opens the
  // modal when the player taps it — so it can never stack over the celebration
  // or the consolation moment (win and failure alike).
  const [needSurvey] = useState(() => !hasAnsweredSurvey())
  const [surveyRetired, setSurveyRetired] = useState(false)
  const [surveyEntryReady, setSurveyEntryReady] = useState(false)
  const [surveyModalOpen, setSurveyModalOpen] = useState(false)

  // A server rejection notice (成绩未通过合理性校验) must be resolved before the
  // survey entry folds in — the player has to see why nothing landed.
  const rejectionShowing = submitFailed && submitFailKind === 'rejected'
  // A won daily run settles when its rank outcome arrives (revealed or failed),
  // or the identity resolved to a state with no pending auto-submit (anon /
  // need-name). Any other run settles on mount.
  const celebrationSettled =
    !hasFinishedDailyRun ||
    rankResult !== null ||
    submitFailed ||
    identity.status === 'anon' ||
    identity.status === 'need-name'
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
    const id = setTimeout(() => setSurveyEntryReady(true), surveyDelayMs)
    return () => clearTimeout(id)
  }, [needSurvey, noRunData, celebrationSettled, surveyDelayMs])

  const surveyEntryVisible = needSurvey && !surveyRetired && surveyEntryReady && !rejectionShowing

  const handleSurveySubmit = useCallback((survey: SurveyAnswers) => {
    logEvent('survey_submit', { ...survey })
    markSurveyAnswered()
    setSurveyRetired(true)
    setSurveyModalOpen(false)
  }, [])

  const handleSurveySkip = useCallback(() => {
    markSurveyAnswered()
    setSurveyRetired(true)
    setSurveyModalOpen(false)
  }, [])

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
                    {identity.status === 'resolving' && '正在准备上榜…'}

                    {identity.status === 'anon' && (
                      // ONE calm login invite (ruling B / U13): honest, never
                      // stacked over the celebration. Decline = the run simply
                      // is not on the board.
                      <>
                        这局拆弹成功，但还没上榜。登录后自动记录成绩，看看你排第几。
                        <button
                          className={styles.inviteCta}
                          onClick={() => window.location.assign('/login')}
                        >
                          登录 / 注册<span aria-hidden="true"> →</span>
                        </button>
                      </>
                    )}

                    {identity.status === 'need-name' && (
                      <>
                        这局成绩还没上榜。在「我的」里给自己起个名字，就能自动上榜。
                        <button
                          className={styles.inviteCta}
                          onClick={() => window.location.assign('/me')}
                        >
                          去设置名字<span aria-hidden="true"> →</span>
                        </button>
                      </>
                    )}

                    {identity.status === 'signed-in' &&
                      (resolvedMetadata === null ? (
                        // First-time BYO run — the tool is not inferable and no
                        // choice is stored. One inline row of SSOT chips, picked
                        // once and remembered, then the run auto-submits.
                        <div className={styles.toolAsk}>
                          <div className={styles.toolAskLabel}>和哪个 AI 一起玩的？</div>
                          <div className={styles.toolChips}>
                            {AI_TOOLS.map((tool) => (
                              <button
                                key={tool}
                                type="button"
                                className={styles.toolChip}
                                onClick={() => handlePickAiTool(tool.toLowerCase())}
                              >
                                {tool}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : submitting ? (
                        '正在把成绩送上榜…'
                      ) : (
                        submitFailed &&
                        (submitFailKind === 'rejected' ? (
                          // Server reached and refused — not an offline state.
                          // Retry once for transient refusals (e.g. rate limit);
                          // a persistent rejection points the player at feedback.
                          // Fully-localized honest copy (F2): a 429 is a pacing
                          // limit that a later retry clears; anything else is the
                          // plausibility校验. Neither leaks the server's raw
                          // English string or the 60s threshold.
                          retried ? (
                            <>
                              {submitFailStatus === 429
                                ? '提交太频繁，请稍后再来重新提交。'
                                : '成绩未通过合理性校验，暂时无法上榜。'}
                              可邮件反馈 byheaven0912@gmail.com
                            </>
                          ) : (
                            <>
                              {submitFailStatus === 429
                                ? '提交太频繁，请稍后再试'
                                : '成绩未通过合理性校验'}
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
                        ))
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Settlement reward drop (reward-economy §3): a credited win lands a
              +5 ✦ 星芒 beat; a capped daily quota reads a muted note; a duplicate
              (run replay) / absent reward shows nothing. */}
          {showRankCard && rankResult?.reward?.status === 'credited' && (
            <div className={styles.rewardDrop} role="status" aria-label="过关奖励">
              <span className={styles.rewardDropAmount}>
                +{rankResult.reward.amount} {STARBURST_GLYPH}
              </span>
              <span className={styles.rewardDropLabel}>{STARBURST_LABEL}</span>
            </div>
          )}
          {showRankCard && rankResult?.reward?.status === 'capped' && (
            <p className={styles.rewardCapped}>今日过关奖励已满</p>
          )}
          {/* Check-in reward beat (reward-economy §4): the day's first qualified
              activity banked +3 星芒. Distinct from the per-win drop above — a
              single first-of-day defuse shows both. */}
          {checkinCredited !== null && (
            <div className={styles.checkinBeat} role="status" aria-label="今日打卡奖励">
              <span className={styles.checkinBeatAmount}>
                +{checkinCredited.amount} {STARBURST_GLYPH}
              </span>
              <span className={styles.checkinBeatLabel}>{STARBURST_LABEL} · 今日打卡</span>
            </div>
          )}

          {variant === 'failure' && (
            <div className={styles.quote}>
              <div className={styles.quoteLabel}>AI 说</div>
              <p className={styles.quoteBody}>「{consolationText(outcome, state.strikeCount)}」</p>
            </div>
          )}

          {/* U12: 再来一局 + 回主页 sit on the first screen, right after the rank
              reveal / consolation — the roguelike momentum CTA is one tap away,
              not buried under the profile / breakdown cards below. */}
          <div className={styles.cta}>
            <Button variant="primary" full onClick={handlePlayAgain}>
              再来一局<span aria-hidden="true"> →</span>
            </Button>
            <Button variant="ghost" full onClick={() => navigate('/bombsquad')}>
              回主页
            </Button>
          </div>

          {showDailyLoopCard && (
            <div className={styles.loopCard}>
              <div>
                <div className={styles.loopLabel}>我的档案</div>
                <div className={styles.loopTitle}>{profileSaveText(profileSaveState)}</div>
                {/* rc §3 #6/#7 + U15: the default line is the warm fact; the
                    streak counts + the per-card UTC-reset caption relocate into
                    ONE ⓘ instead of defaulting a caption onto every card. */}
                <p className={styles.loopText}>
                  {state.mode === 'daily' &&
                  outcome === 'defused' &&
                  dailyLoop?.streak.today_completed
                    ? `第 ${dailyLoop.streak.current_days} 天，拿下。`
                    : '本局已保存。'}
                  <Disclosure label="连续打卡与刷新说明">
                    {(state.mode === 'daily' &&
                    outcome === 'defused' &&
                    dailyLoop?.streak.today_completed
                      ? `连续 ${dailyLoop.streak.current_days} 天 · 最长 ${dailyLoop.streak.longest_days} 天 · `
                      : state.mode === 'daily' && outcome === 'defused'
                        ? '连续打卡状态以今日活动为准 · '
                        : '练习、失败和超时不计入连续打卡 · ') + getDailyResetHint()}
                  </Disclosure>
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

          {surveyEntryVisible && (
            // U13 fold-in: a calm survey entry at the very bottom, after everything
            // has settled — tapping it opens the survey modal. It never pops over
            // the celebration or the consolation.
            <button
              type="button"
              className={styles.surveyEntry}
              onClick={() => setSurveyModalOpen(true)}
            >
              聊聊这一局<span aria-hidden="true"> →</span>
            </button>
          )}
        </div>
      </div>

      <PostGameModal
        open={surveyModalOpen}
        onSubmit={handleSurveySubmit}
        onSkip={handleSurveySkip}
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
