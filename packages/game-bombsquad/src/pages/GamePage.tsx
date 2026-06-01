import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import yaml from 'js-yaml'
import type { Manual, SceneInfo, ModuleConfig, ModuleAnswer } from '@shared/manual-schema'
import { useGame, MODULE_SEQUENCE, type ModuleKind } from '@/store/game-context'
import { useTimer } from '@/hooks/useTimer'
import { createRng, type Rng } from '@/engine/rng'
import {
  loadManual,
  ManualNetworkError,
  ManualNotFoundError,
  ManualParseError,
} from '@/utils/yaml-loader'
import { logEvent } from '@/utils/event-log'
import { formatMs } from '@shared/format-time'
import { generateWire } from '@/modules/wire/generator'
import { generateDial } from '@/modules/dial/generator'
import { generateButton } from '@/modules/button/generator'
import { generateKeypad } from '@/modules/keypad/generator'
import Timer from '@/components/Timer'
import ProgressBar from '@/components/ProgressBar'
import SceneInfoBar from '@/components/SceneInfoBar'
import MuteButton from '@/components/MuteButton'
import StrikeIndicator from '@/components/StrikeIndicator'
import ExplosionOverlay from '@/components/ExplosionOverlay'
import { Scenery } from '@amiclaw/ui'
import Eyebrow from '@/components/bombsquad/Eyebrow'
import WireModule from '@/modules/wire/WireModule'
import DialModule from '@/modules/dial/DialModule'
import ButtonModule from '@/modules/button/ButtonModule'
import KeypadModule from '@/modules/keypad/KeypadModule'
import practiceYamlRaw from '../../../manual/data/practice.yaml?raw'
import { generateSceneInfo } from '@/engine/scene-info'
import { getAttemptNumberForMode, getRunSeed } from '@/utils/session'
import { getAudioContext } from '@/audio/audio-context'
import styles from './GamePage.module.css'

// Module display labels — the Atlas redesign renames three of the four
// puzzles (design_handoff_bombsquad README §1): 线路→光弦, 密码盘→星盘,
// 键盘→星符. The button module has no handoff name and keeps 按钮. The
// internal ModuleKind identifiers (wire/dial/button/keypad) are unchanged.
const MODULE_LABEL: Record<ModuleKind, string> = {
  wire: '光弦',
  dial: '星盘',
  button: '按钮',
  keypad: '星符',
}

// How long the CSS explosion plays before routing to the failure result
// page — kept in step with the ExplosionOverlay keyframe durations.
const EXPLOSION_DURATION_MS = 1400

// Daily-challenge low-time warning threshold — timer turns red below this.
const LOW_TIME_THRESHOLD_MS = 60_000

// Two-line diagnostic copy: line 1 names what just happened locally, line 2
// names the AI partner's now-stale view. Kept as an array so the two lines
// stay independently inspectable and we can render them as separate spans
// without depending on CSS `white-space: pre-line` handling.
const REFRESH_BANNER_LINES: readonly [string, string] = [
  '你刚刷新了页面，这一关的状态被重置了。',
  'AI 那边没收到通知，还在等你之前在做的事。',
]

// Module-level, computed once when this module is first imported. Reads the
// navigation entry — which is stable for the lifetime of the document — so
// further reads within the SPA see the same value.
const documentLoadedViaReload: boolean = (() => {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return false
  const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  return entries[0]?.type === 'reload'
})()

// One-shot consumption flag. Lives at module scope so it survives GamePage
// unmount/remount within the same document (exit → home → re-enter game),
// but resets cleanly on the next real document load. Mutated only from a
// commit-phase effect, never from `detectRefresh` itself — keeping the
// detector free of render-time side effects so React StrictMode's dev-mode
// double-invocation of `useState` initializers cannot accidentally burn
// the flag before the component is actually shown.
let refreshBannerConsumed = false

/**
 * Pure read: returns true iff the current document load was a browser
 * refresh AND the banner hasn't been consumed yet. Safe to call from a
 * `useState` initializer because it does not mutate module state. Actual
 * consumption is performed by `consumeRefreshBanner` from a commit-phase
 * effect (see GamePage below).
 */
function detectRefresh(): boolean {
  return documentLoadedViaReload && !refreshBannerConsumed
}

/** Mark the refresh banner as consumed for the rest of this document's life. */
function consumeRefreshBanner(): void {
  refreshBannerConsumed = true
}

// First-run nudge pointing the player at the scene-info bar. A first-timer
// often skips reading 暗号/电池/指示灯 to the AI and stalls, so on the first
// module we surface a one-time, dismissible hint. Persisted in localStorage so
// it shows once ever, never nagging on later runs. Read defensively — a denied
// or full localStorage simply means the hint is treated as already seen.
const SCENE_NUDGE_SEEN_KEY = 'bombsquad:scene-nudge-seen'

function sceneNudgeAlreadySeen(): boolean {
  try {
    return localStorage.getItem(SCENE_NUDGE_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

function markSceneNudgeSeen(): void {
  try {
    localStorage.setItem(SCENE_NUDGE_SEEN_KEY, '1')
  } catch {
    /* storage unavailable — the in-memory `everSeen` flag still hides it after this run */
  }
}

/** Generate a single module's `{ config, answer }` pair by its kind. */
function generateModuleByKind(
  kind: ModuleKind,
  rng: Rng,
  manual: Manual,
  sceneInfo: SceneInfo
): { config: ModuleConfig; answer: ModuleAnswer } {
  switch (kind) {
    case 'wire':
      return generateWire(rng, manual.modules.wire_routing.rules, sceneInfo)
    case 'dial':
      return generateDial(rng, manual.modules.symbol_dial, sceneInfo)
    case 'button':
      return generateButton(rng, manual.modules.button.rules, sceneInfo)
    case 'keypad':
      return generateKeypad(rng, manual.modules.keypad, sceneInfo)
  }
}

/** Generate puzzles for the run's module sequence, in order. */
function generateSequence(
  sequence: ModuleKind[],
  rng: Rng,
  manual: Manual,
  sceneInfo: SceneInfo
): { configs: ModuleConfig[]; answers: ModuleAnswer[] } {
  const configs: ModuleConfig[] = []
  const answers: ModuleAnswer[] = []
  for (const kind of sequence) {
    const { config, answer } = generateModuleByKind(kind, rng, manual, sceneInfo)
    configs.push(config)
    answers.push(answer)
  }
  return { configs, answers }
}

/** Load a daily manual with sessionStorage fallback on network failure. */
async function loadWithCache(manualUrl: string): Promise<Manual> {
  const cacheKey = `manual-cache:${manualUrl}`
  try {
    const manual = await loadManual(manualUrl)
    // Cache for offline fallback
    try {
      sessionStorage.setItem(cacheKey, yaml.dump(manual))
    } catch {
      /* storage full */
    }
    return manual
  } catch (err) {
    // 404 means the manual was never published — no point consulting the cache.
    // Re-throw so the caller can render a dedicated "not published" UI.
    if (err instanceof ManualNotFoundError) throw err
    // Parse error means the server-side YAML is malformed — the cached copy
    // (a successfully-loaded earlier dump) won't help the user understand the
    // current breakage, and we want UI to surface "format" not "network".
    if (err instanceof ManualParseError) throw err
    // Network error (fetch reject / 5xx etc.) — try cached copy first.
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      try {
        return yaml.load(cached) as Manual
      } catch {
        /* cached blob unreadable — fall through to typed error */
      }
    }
    if (err instanceof ManualNetworkError) throw err
    throw new ManualNetworkError(manualUrl, undefined, err)
  }
}

export default function GamePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = (searchParams.get('mode') ?? 'practice') as 'practice' | 'daily'
  const customUrl = searchParams.get('url')

  const { state, dispatch } = useGame()

  // A wrong answer pulses a red border around the whole module panel so the
  // mistake is obvious at a glance in both modes. Incrementing this key
  // remounts the pulse element, restarting the CSS animation on every error.
  const [errorPulseKey, setErrorPulseKey] = useState(0)

  // A correct answer gets the positive counterpart: a single green border
  // bloom over the same module panel, so a win reads at panel level rather
  // than as the old small text alone. Keyed like the error pulse so it
  // restarts on each module solved.
  const [successPulseKey, setSuccessPulseKey] = useState(0)

  // Captured once on mount so it stays stable across re-renders. The player
  // can dismiss it; once dismissed it does not reappear for the lifetime of
  // this page (state lives in component memory, intentionally not persisted).
  const [wasRefreshed] = useState<boolean>(detectRefresh)
  const [refreshBannerDismissed, setRefreshBannerDismissed] = useState(false)
  const showRefreshBanner = wasRefreshed && !refreshBannerDismissed

  // First-run scene-info nudge. Captured once on mount so a player who has
  // seen it before never gets it again; dismissible mid-run. Only shown on the
  // first module while actively playing, and only until the player advances.
  const [sceneNudgeEverSeen] = useState<boolean>(sceneNudgeAlreadySeen)
  const [sceneNudgeDismissed, setSceneNudgeDismissed] = useState(false)
  const showSceneNudge =
    !sceneNudgeEverSeen &&
    !sceneNudgeDismissed &&
    state.status === 'PLAYING' &&
    state.currentModuleIndex === 0

  // Mark the nudge seen the moment it first appears, so a future run never
  // shows it — independent of whether the player dismisses it this run.
  useEffect(() => {
    if (showSceneNudge) markSceneNudgeSeen()
  }, [showSceneNudge])

  // Consume the one-shot refresh flag from a commit-phase effect rather than
  // from inside `detectRefresh`. This keeps the detector pure so StrictMode's
  // dev-mode double-invocation of the `useState` initializer cannot burn the
  // flag before the component is actually shown. Idempotent under StrictMode
  // mount → cleanup → mount cycle: setting the flag to `true` twice is fine.
  useEffect(() => {
    if (wasRefreshed) consumeRefreshBanner()
  }, [wasRefreshed])

  // Auto-dismiss the banner 5 seconds after it first appears. Gated on
  // `wasRefreshed` so we never start a timer on a fresh navigation, and on
  // `refreshBannerDismissed` so a manual × tap immediately cancels the
  // pending timer (cleanup runs, no orphan setState fires later).
  useEffect(() => {
    if (!wasRefreshed) return
    if (refreshBannerDismissed) return
    const id = setTimeout(() => {
      setRefreshBannerDismissed(true)
    }, 5000)
    return () => clearTimeout(id)
  }, [wasRefreshed, refreshBannerDismissed])

  const refreshBanner = showRefreshBanner ? (
    <div className={styles.refreshBanner} role="status">
      <span className={styles.refreshBannerText}>
        <span>{REFRESH_BANNER_LINES[0]}</span>
        <br />
        <span>{REFRESH_BANNER_LINES[1]}</span>
      </span>
      <button
        type="button"
        className={styles.refreshBannerDismiss}
        onClick={() => setRefreshBannerDismissed(true)}
        aria-label="关闭提示"
      >
        ×
      </button>
    </div>
  ) : null

  // Countdown timer. `useTimer` still measures elapsed wall-clock time; the
  // direction flip to "remaining" happens here, the single place it lives.
  const { elapsedMs } = useTimer(state.totalStartTime, state.totalEndTime)
  const remainingMs = Math.max(0, state.timeBudgetMs - elapsedMs)
  const timerDisplay = formatMs(remainingMs)
  const isRunning = state.status === 'PLAYING' || state.status === 'MODULE_COMPLETE'
  const lowTime = state.mode === 'daily' && isRunning && remainingMs < LOW_TIME_THRESHOLD_MS

  // Load the manual on mount — but skip the reload if the provider already
  // restored a live, in-progress run for this exact mode from sessionStorage.
  // Without that guard, an accidental F5 would replay START_LOADING, reset
  // the timer, regenerate the run's puzzles, and throw away the module stats
  // the player had already earned.
  useEffect(() => {
    const hasRestoredRun =
      state.mode === mode &&
      state.manual !== null &&
      state.sceneInfo !== null &&
      state.moduleConfigs.length > 0 &&
      state.moduleConfigs.every((c) => c !== null) &&
      ['READY', 'PLAYING', 'MODULE_COMPLETE', 'ALL_COMPLETE', 'EXPLODING'].includes(state.status)

    if (hasRestoredRun) {
      // The restored run already has its puzzles — nothing to load or
      // regenerate. (Answers are never regenerated on error any more.)
      return
    }

    const seed = getRunSeed(mode)
    const rng = createRng(seed)

    // Always derive the manual URL from the current origin so whichever
    // domain is serving the game also serves the matching manual, and the
    // AI partner never hits a 404 from a stale hardcoded hostname.
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://claw.amio.fans'
    const manualUrl =
      mode === 'practice'
        ? `${origin}/manual/practice`
        : (customUrl ?? `${origin}/manual/${new Date().toISOString().slice(0, 10)}`)
    const attemptNumber = getAttemptNumberForMode(mode)

    dispatch({ type: 'START_LOADING', mode, manualUrl, attemptNumber })

    const load = async () => {
      try {
        let manual: Manual
        if (mode === 'practice') {
          manual = yaml.load(practiceYamlRaw) as Manual
        } else {
          manual = await loadWithCache(manualUrl)
        }

        const sceneInfo = generateSceneInfo(rng)

        let configs: ModuleConfig[]
        let answers: ModuleAnswer[]
        try {
          const result = generateSequence(MODULE_SEQUENCE[mode], rng, manual, sceneInfo)
          configs = result.configs
          answers = result.answers
        } catch (genErr) {
          console.error('Generator exhaustion:', genErr)
          dispatch({
            type: 'LOAD_ERROR',
            message: '谜题生成失败，请重新开始。',
          })
          return
        }

        dispatch({
          type: 'MANUAL_LOADED',
          manual,
          sceneInfo,
          moduleConfigs: configs,
          moduleAnswers: answers,
          rngSeed: seed,
        })
      } catch (err) {
        if (err instanceof ManualNotFoundError) {
          dispatch({ type: 'LOAD_ERROR', message: err.message, kind: 'not_published' })
        } else if (err instanceof ManualParseError) {
          dispatch({
            type: 'LOAD_ERROR',
            message: '手册格式异常，请截图邮件反馈给 byheaven0912@gmail.com',
            kind: 'yaml_parse',
          })
        } else if (err instanceof ManualNetworkError) {
          dispatch({
            type: 'LOAD_ERROR',
            message:
              '加载失败，请检查网络或换 Chrome / Safari 试试。一直失败可邮件 byheaven0912@gmail.com',
            kind: 'network',
          })
        } else {
          dispatch({
            type: 'LOAD_ERROR',
            message: err instanceof Error ? err.message : '手册加载失败',
            kind: 'generic',
          })
        }
      }
    }

    load()
    // Re-run when mode changes so switching between daily and practice (e.g. via
    // the "Try Practice" fallback on a 404 daily manual) reloads the correct manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Navigate to result when ALL_COMPLETE transitions to RESULT
  useEffect(() => {
    if (state.status === 'ALL_COMPLETE') {
      dispatch({ type: 'ALL_MODULES_COMPLETE' })
    }
  }, [state.status, dispatch])

  useEffect(() => {
    if (state.status === 'RESULT') {
      navigate('/bombsquad/result')
    }
  }, [state.status, navigate])

  // Auto-advance from MODULE_COMPLETE after 800ms
  useEffect(() => {
    if (state.status !== 'MODULE_COMPLETE') return
    const timeout = setTimeout(() => {
      dispatch({ type: 'NEXT_MODULE' })
    }, 800)
    return () => clearTimeout(timeout)
  }, [state.status, dispatch])

  // Countdown-zero detection. `remainingMs` is recomputed every animation
  // frame by `useTimer`, so the frame the budget runs out this effect fires
  // TIME_EXPIRED. Short-circuited once `totalEndTime` is set (run resolved),
  // which also covers the last-module win lock — a daily run whose final
  // module was just solved has `totalEndTime` stamped and is immune here.
  useEffect(() => {
    if (state.totalStartTime === null || state.totalEndTime !== null) return
    if (state.status !== 'PLAYING' && state.status !== 'MODULE_COMPLETE') return
    if (remainingMs > 0) return
    dispatch({ type: 'TIME_EXPIRED' })
  }, [remainingMs, state.status, state.totalStartTime, state.totalEndTime, dispatch])

  // Auto-advance EXPLODING → RESULT once the explosion animation has played.
  useEffect(() => {
    if (state.status !== 'EXPLODING') return
    const id = setTimeout(() => {
      dispatch({ type: 'EXPLOSION_DONE' })
    }, EXPLOSION_DURATION_MS)
    return () => clearTimeout(id)
  }, [state.status, dispatch])

  const handleModuleComplete = useCallback(() => {
    const moduleType = state.moduleSequence[state.currentModuleIndex] ?? 'unknown'
    // Reducer computes time from state.currentModuleStartTime (Date.now()
    // based), and reads state.currentModuleErrorCount. Keeping those in
    // state, not refs, is what makes refresh-resilience possible.
    dispatch({ type: 'MODULE_COMPLETE', moduleType })
    // Positive panel bloom, mirroring the error pulse. Fires under the
    // completion overlay's brief fade-in so it reads as the leading edge of
    // the green payoff.
    setSuccessPulseKey((key) => key + 1)
  }, [dispatch, state.moduleSequence, state.currentModuleIndex])

  const handleExitRun = useCallback(() => {
    if (!window.confirm('退出当前关卡？进度会清空。')) return
    const elapsed = state.totalStartTime !== null ? Date.now() - state.totalStartTime : null
    logEvent('game_abandon', {
      currentModuleIndex: state.currentModuleIndex,
      elapsedMs: elapsed,
      mode: state.mode,
    })
    dispatch({ type: 'RESET' })
    // Exit to the platform homepage — a separate SPA at the root, so this is a
    // full-page navigation, not a client-side router push.
    window.location.assign('/')
  }, [dispatch, state.currentModuleIndex, state.mode, state.totalStartTime])

  // A wrong answer no longer regenerates the puzzle — the player retries the
  // same puzzle in place. The mode branch (strike vs. nothing) lives in the
  // reducer's MODULE_ERROR handler; GamePage only fires the module-area error
  // pulse, shown identically in both modes.
  const handleModuleError = useCallback(() => {
    dispatch({ type: 'MODULE_ERROR' })
    setErrorPulseKey((key) => key + 1)
  }, [dispatch])

  const renderModule = () => {
    const idx = state.currentModuleIndex
    const kind = state.moduleSequence[idx]
    const config = state.moduleConfigs[idx]
    const answer = state.moduleAnswers[idx]
    const sceneInfo = state.sceneInfo
    if (!kind || !config || !answer || !sceneInfo) return null

    const commonProps = {
      onComplete: handleModuleComplete,
      onError: handleModuleError,
      sceneInfo,
    }

    switch (kind) {
      case 'wire':
        return <WireModule config={config as never} answer={answer as never} {...commonProps} />
      case 'dial':
        return <DialModule config={config as never} answer={answer as never} {...commonProps} />
      case 'button':
        return <ButtonModule config={config as never} answer={answer as never} {...commonProps} />
      case 'keypad':
        return <KeypadModule config={config as never} answer={answer as never} {...commonProps} />
    }
  }

  // LOADING state
  if (state.status === 'LOADING') {
    return (
      <main className={styles.page}>
        {refreshBanner}
        <div className={styles.overlay}>
          {state.errorMessage ? (
            state.errorKind === 'not_published' ? (
              <>
                <p className={styles.errorText}>
                  今天的手册还没发布。
                  <br />
                  可以先玩练习模式，或稍后再来。
                </p>
                <button
                  className={styles.startBtn}
                  onClick={() => navigate('/bombsquad/run?mode=practice', { replace: true })}
                >
                  去练习
                </button>
                <a href="/" className={styles.homeLink}>
                  ← 返回平台首页
                </a>
              </>
            ) : state.errorKind === 'yaml_parse' ? (
              <>
                <p className={styles.errorText}>
                  手册格式异常，请截图邮件反馈给 byheaven0912@gmail.com
                </p>
                <button className={styles.retryBtn} onClick={() => window.location.reload()}>
                  重试
                </button>
                <a href="/" className={styles.homeLink}>
                  ← 返回平台首页
                </a>
              </>
            ) : (
              <>
                <p className={styles.errorText}>
                  {state.errorKind === 'network'
                    ? '加载失败，请检查网络或换 Chrome / Safari 试试。一直失败可邮件 byheaven0912@gmail.com'
                    : state.errorMessage}
                </p>
                <button className={styles.retryBtn} onClick={() => window.location.reload()}>
                  重试
                </button>
                <a href="/" className={styles.homeLink}>
                  ← 返回平台首页
                </a>
              </>
            )
          ) : (
            <p className={styles.loadingText}>加载手册中…</p>
          )}
        </div>
      </main>
    )
  }

  // READY state — waiting for the player to start. Both modes show the same
  // terse "ready?" prompt; the game page never teaches the player — all
  // guidance comes from the AI voice partner.
  if (state.status === 'READY') {
    // Unlock the shared AudioContext inside this user-gesture handler so iOS
    // Safari permits audio to start when the stopwatch loop begins (the
    // stopwatch effect itself runs outside a gesture).
    const handleStart = () => {
      getAudioContext()
      dispatch({ type: 'START_GAME' })
    }
    return (
      <main className={styles.page}>
        {refreshBanner}
        <div className={styles.overlay}>
          <p className={styles.readyText}>准备好了吗？</p>
          <button className={styles.startBtn} onClick={handleStart}>
            开始
          </button>
        </div>
      </main>
    )
  }

  // PLAYING / MODULE_COMPLETE / EXPLODING states
  const currentKind = state.moduleSequence[state.currentModuleIndex]
  const moduleLabel = currentKind ? MODULE_LABEL[currentKind] : ''

  return (
    <main className={styles.page}>
      <Scenery accent="yellow" />
      {refreshBanner}
      <div className={styles.topBar}>
        <div className={styles.timerCluster}>
          <Timer display={timerDisplay} isRunning={isRunning} lowTime={lowTime} />
          {state.mode === 'daily' && <StrikeIndicator strikeCount={state.strikeCount} />}
        </div>
        <div className={styles.modeMeta}>
          <div>{mode === 'daily' ? '每日' : '练习'}</div>
          <div>{mode === 'daily' ? `第 ${state.attemptNumber} 次` : '本地练习'}</div>
        </div>
        <div className={styles.topBarActions}>
          <MuteButton className={styles.muteBtn} />
          <button
            type="button"
            className={styles.exitBtn}
            onClick={handleExitRun}
            aria-label="退出当前关卡"
          >
            退出
          </button>
        </div>
      </div>

      <div className={styles.moduleArea}>
        <div className={styles.modulePanel}>
          <div className={styles.modLabelRow}>
            <Eyebrow dot>
              模块 {state.currentModuleIndex + 1}/{state.moduleSequence.length} · {moduleLabel}
            </Eyebrow>
          </div>
          {renderModule()}
        </div>
        {errorPulseKey > 0 && (
          <div key={`err-${errorPulseKey}`} className={styles.errorPulse} aria-hidden="true" />
        )}
        {successPulseKey > 0 && (
          <div key={`ok-${successPulseKey}`} className={styles.successPulse} aria-hidden="true" />
        )}
      </div>

      <div className={styles.bottomArea}>
        {state.sceneInfo && (
          <SceneInfoBar
            sceneInfo={state.sceneInfo}
            showNudge={showSceneNudge}
            onDismissNudge={() => setSceneNudgeDismissed(true)}
          />
        )}
        <ProgressBar
          total={state.moduleSequence.length}
          completed={state.currentModuleIndex}
          current={state.currentModuleIndex}
        />
      </div>

      {state.status === 'MODULE_COMPLETE' && (
        <div className={`${styles.overlay} ${styles.overlayComplete}`}>
          <div className={styles.defusedBurst} aria-hidden="true" />
          <p className={styles.defusedText}>拆除成功</p>
        </div>
      )}

      {state.status === 'EXPLODING' && <ExplosionOverlay />}
    </main>
  )
}
