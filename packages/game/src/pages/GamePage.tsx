import { useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import yaml from 'js-yaml'
import type { Manual, SceneInfo, ModuleConfig, ModuleAnswer } from '@shared/manual-schema'
import { useGame } from '@/store/game-context'
import { useTimer } from '@/hooks/useTimer'
import { createRng, type Rng } from '@/engine/rng'
import { loadManual, ManualNotFoundError } from '@/utils/yaml-loader'
import { logEvent } from '@/utils/event-log'
import { generateWire } from '@/modules/wire/generator'
import { generateDial } from '@/modules/dial/generator'
import { generateButton } from '@/modules/button/generator'
import { generateKeypad } from '@/modules/keypad/generator'
import Timer from '@/components/Timer'
import ProgressBar from '@/components/ProgressBar'
import SceneInfoBar from '@/components/SceneInfoBar'
import WireModule from '@/modules/wire/WireModule'
import DialModule from '@/modules/dial/DialModule'
import ButtonModule from '@/modules/button/ButtonModule'
import KeypadModule from '@/modules/keypad/KeypadModule'
import practiceYamlRaw from '../../../manual/data/practice.yaml?raw'
import { getAttemptNumberForMode, getRunSeed } from '@/utils/session'
import styles from './GamePage.module.css'

const MODULE_NAMES = ['线路', '密码盘', '按钮', '键盘'] as const

const INDICATOR_LABELS = ['FRK', 'CAR', 'NSA', 'MSA', 'SND', 'CLR', 'BOB', 'TRN']
const SERIAL_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

function generateSceneInfo(rng: Rng): SceneInfo {
  const serialNumber = Array.from(
    { length: 6 },
    () => SERIAL_CHARS[rng.intBetween(0, SERIAL_CHARS.length - 1)]
  ).join('')
  const batteryCount = rng.intBetween(1, 4)
  const indicatorCount = rng.intBetween(0, 3)
  const indicators = Array.from({ length: indicatorCount }, () => ({
    label: rng.pick(INDICATOR_LABELS),
    lit: rng.float() < 0.5,
  }))
  return { serialNumber, batteryCount, indicators }
}

function generateAllModules(
  rng: Rng,
  manual: Manual,
  sceneInfo: SceneInfo
): { configs: ModuleConfig[]; answers: ModuleAnswer[] } {
  const wire = generateWire(rng, manual.modules.wire_routing.rules, sceneInfo)
  const dial = generateDial(rng, manual.modules.symbol_dial, sceneInfo)
  const button = generateButton(rng, manual.modules.button.rules, sceneInfo)
  const keypad = generateKeypad(rng, manual.modules.keypad, sceneInfo)
  return {
    configs: [wire.config, dial.config, button.config, keypad.config],
    answers: [wire.answer, dial.answer, button.answer, keypad.answer],
  }
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
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) return yaml.load(cached) as Manual
    throw new Error('手册加载失败，请检查网络。')
  }
}

export default function GamePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = (searchParams.get('mode') ?? 'practice') as 'practice' | 'daily'
  const customUrl = searchParams.get('url')

  const { state, dispatch } = useGame()
  const rngRef = useRef<Rng | null>(null)

  const { display: timerDisplay } = useTimer(state.totalStartTime, state.totalEndTime)
  const isRunning = state.status === 'PLAYING' || state.status === 'MODULE_COMPLETE'

  // Load the manual on mount — but skip the reload if the provider already
  // restored a live, in-progress run for this exact mode from sessionStorage.
  // Without that guard, an accidental F5 would replay START_LOADING, reset
  // the timer, regenerate all 4 puzzles, and throw away the module stats the
  // player had already earned.
  useEffect(() => {
    const hasRestoredRun =
      state.mode === mode &&
      state.manual !== null &&
      state.sceneInfo !== null &&
      state.moduleConfigs.every((c) => c !== null) &&
      ['READY', 'PLAYING', 'MODULE_COMPLETE', 'ALL_COMPLETE'].includes(state.status)

    if (hasRestoredRun) {
      // Still need a working RNG for error-regeneration, but it can be a
      // fresh one — regen just needs new random values, not reproducibility.
      if (rngRef.current === null) {
        rngRef.current = createRng(state.rngSeed || Date.now())
      }
      return
    }

    const seed = getRunSeed(mode)
    const rng = createRng(seed)
    rngRef.current = rng

    // Always derive the manual URL from the current origin so whichever
    // domain is serving the game also serves the matching manual, and the
    // AI partner never hits a 404 from a stale hardcoded hostname.
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://bombsquad.amio.fans'
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
          const result = generateAllModules(rng, manual, sceneInfo)
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
        const notPublished = err instanceof ManualNotFoundError
        dispatch({
          type: 'LOAD_ERROR',
          message: err instanceof Error ? err.message : '手册加载失败',
          kind: notPublished ? 'not_published' : 'generic',
        })
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
      navigate('/result')
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

  const handleModuleComplete = useCallback(() => {
    const moduleType = ['wire', 'dial', 'button', 'keypad'][state.currentModuleIndex]
    // Reducer computes time from state.currentModuleStartTime (Date.now()
    // based), and reads state.currentModuleErrorCount. Keeping those in
    // state, not refs, is what makes refresh-resilience possible.
    dispatch({ type: 'MODULE_COMPLETE', moduleType })
  }, [dispatch, state.currentModuleIndex])

  const handleExitRun = useCallback(() => {
    if (!window.confirm('退出当前关卡？进度会清空。')) return
    const elapsedMs = state.totalStartTime !== null ? Date.now() - state.totalStartTime : null
    logEvent('game_abandon', {
      currentModuleIndex: state.currentModuleIndex,
      elapsedMs,
      mode: state.mode,
    })
    dispatch({ type: 'RESET' })
    navigate('/')
  }, [dispatch, navigate, state.currentModuleIndex, state.mode, state.totalStartTime])

  const handleModuleError = useCallback(() => {
    const rng = rngRef.current
    const manual = state.manual
    const sceneInfo = state.sceneInfo
    if (!rng || !manual || !sceneInfo) return

    try {
      const idx = state.currentModuleIndex
      let config: ModuleConfig
      let answer: ModuleAnswer
      if (idx === 0) {
        const result = generateWire(rng, manual.modules.wire_routing.rules, sceneInfo)
        config = result.config
        answer = result.answer
      } else if (idx === 1) {
        const result = generateDial(rng, manual.modules.symbol_dial, sceneInfo)
        config = result.config
        answer = result.answer
      } else if (idx === 2) {
        const result = generateButton(rng, manual.modules.button.rules, sceneInfo)
        config = result.config
        answer = result.answer
      } else {
        const result = generateKeypad(rng, manual.modules.keypad, sceneInfo)
        config = result.config
        answer = result.answer
      }
      dispatch({ type: 'REGENERATE_MODULE', config, answer })
    } catch (genErr) {
      console.error('Generator exhaustion during error regeneration:', genErr)
      dispatch({
        type: 'LOAD_ERROR',
        message: '谜题生成失败，请重新开始。',
      })
    }
  }, [dispatch, state.currentModuleIndex, state.manual, state.sceneInfo])

  const renderModule = () => {
    const idx = state.currentModuleIndex
    const config = state.moduleConfigs[idx]
    const answer = state.moduleAnswers[idx]
    const sceneInfo = state.sceneInfo
    if (!config || !answer || !sceneInfo) return null

    const commonProps = {
      onComplete: handleModuleComplete,
      onError: handleModuleError,
      sceneInfo,
    }

    if (idx === 0)
      return <WireModule config={config as never} answer={answer as never} {...commonProps} />
    if (idx === 1)
      return <DialModule config={config as never} answer={answer as never} {...commonProps} />
    if (idx === 2)
      return <ButtonModule config={config as never} answer={answer as never} {...commonProps} />
    if (idx === 3)
      return <KeypadModule config={config as never} answer={answer as never} {...commonProps} />
    return null
  }

  // LOADING state
  if (state.status === 'LOADING') {
    return (
      <main className={styles.page}>
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
                  onClick={() => navigate('/game?mode=practice', { replace: true })}
                >
                  去练习
                </button>
                <Link to="/" className={styles.homeLink}>
                  ← 返回首页
                </Link>
              </>
            ) : (
              <>
                <p className={styles.errorText}>{state.errorMessage}</p>
                <button className={styles.retryBtn} onClick={() => window.location.reload()}>
                  重试
                </button>
                <Link to="/" className={styles.homeLink}>
                  ← 返回首页
                </Link>
              </>
            )
          ) : (
            <p className={styles.loadingText}>加载手册中…</p>
          )}
        </div>
      </main>
    )
  }

  // READY state — waiting for player to click Start
  if (state.status === 'READY') {
    return (
      <main className={styles.page}>
        <div className={styles.overlay}>
          <p className={styles.readyText}>准备好了吗？</p>
          <button className={styles.startBtn} onClick={() => dispatch({ type: 'START_GAME' })}>
            开始
          </button>
        </div>
      </main>
    )
  }

  // PLAYING / MODULE_COMPLETE states
  return (
    <main className={styles.page}>
      <div className={styles.topBar}>
        <Timer display={timerDisplay} isRunning={isRunning} />
        <div className={styles.modeMeta}>
          <div>{mode === 'daily' ? '每日' : '练习'}</div>
          <div>{mode === 'daily' ? `第 ${state.attemptNumber} 次` : '本地练习'}</div>
        </div>
        <button
          type="button"
          className={styles.exitBtn}
          onClick={handleExitRun}
          aria-label="退出当前关卡"
        >
          退出
        </button>
      </div>

      <div className={styles.moduleArea}>
        <div>
          <p className={styles.moduleLabel}>{MODULE_NAMES[state.currentModuleIndex]}</p>
          {renderModule()}
        </div>
      </div>

      <div className={styles.bottomArea}>
        {state.sceneInfo && <SceneInfoBar sceneInfo={state.sceneInfo} />}
        <ProgressBar
          total={4}
          completed={state.currentModuleIndex}
          current={state.currentModuleIndex}
        />
      </div>

      {state.status === 'MODULE_COMPLETE' && (
        <div className={styles.overlay}>
          <p className={styles.defusedText}>拆除成功</p>
        </div>
      )}
    </main>
  )
}
