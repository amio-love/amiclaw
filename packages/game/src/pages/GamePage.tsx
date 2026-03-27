import { useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import yaml from 'js-yaml'
import type { Manual, SceneInfo, ModuleConfig, ModuleAnswer } from '@shared/manual-schema'
import { useGame } from '@/store/game-context'
import { useTimer } from '@/hooks/useTimer'
import { createRng, type Rng } from '@/engine/rng'
import { loadManual } from '@/utils/yaml-loader'
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

const MODULE_NAMES = ['WIRE ROUTING', 'SYMBOL DIAL', 'BIG BUTTON', 'KEYPAD'] as const

const INDICATOR_LABELS = ['FRK', 'CAR', 'NSA', 'MSA', 'SND', 'CLR', 'BOB', 'TRN']
const SERIAL_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

function generateSceneInfo(rng: Rng): SceneInfo {
  const serialNumber = Array.from({ length: 6 }, () =>
    SERIAL_CHARS[rng.intBetween(0, SERIAL_CHARS.length - 1)]
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
  sceneInfo: SceneInfo,
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
    try { sessionStorage.setItem(cacheKey, yaml.dump(manual)) } catch { /* storage full */ }
    return manual
  } catch {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) return yaml.load(cached) as Manual
    throw new Error('Could not load manual. Check your connection.')
  }
}

export default function GamePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = (searchParams.get('mode') ?? 'practice') as 'practice' | 'daily'
  const customUrl = searchParams.get('url')

  const { state, dispatch } = useGame()
  const rngRef = useRef<Rng | null>(null)
  const moduleStartRef = useRef<number>(0)
  const errorCountRef = useRef(0)

  const { display: timerDisplay } = useTimer(state.totalStartTime, state.totalEndTime)
  const isRunning = state.status === 'PLAYING' || state.status === 'MODULE_COMPLETE'

  // Load the manual on mount
  useEffect(() => {
    const seed = getRunSeed(mode)
    const rng = createRng(seed)
    rngRef.current = rng

    const manualUrl = mode === 'practice'
      ? 'https://bombsquad.amio.fans/manual/practice'
      : (customUrl ?? `https://bombsquad.amio.fans/manual/${new Date().toISOString().slice(0, 10)}`)
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
            message: 'Puzzle generation failed. Please restart.',
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
        dispatch({
          type: 'LOAD_ERROR',
          message: err instanceof Error ? err.message : 'Failed to load manual',
        })
      }
    }

    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Track module start time when entering PLAYING
  useEffect(() => {
    if (state.status === 'PLAYING') {
      moduleStartRef.current = performance.now()
      errorCountRef.current = 0
    }
  }, [state.status, state.currentModuleIndex])

  // Auto-advance from MODULE_COMPLETE after 800ms
  useEffect(() => {
    if (state.status !== 'MODULE_COMPLETE') return
    const timeout = setTimeout(() => {
      dispatch({ type: 'NEXT_MODULE' })
    }, 800)
    return () => clearTimeout(timeout)
  }, [state.status, dispatch])

  const handleModuleComplete = useCallback(() => {
    const timeMs = performance.now() - moduleStartRef.current
    const moduleType = ['wire', 'dial', 'button', 'keypad'][state.currentModuleIndex]
    dispatch({ type: 'MODULE_COMPLETE', timeMs, errorCount: errorCountRef.current, moduleType })
  }, [dispatch, state.currentModuleIndex])

  const handleModuleError = useCallback(() => {
    const rng = rngRef.current
    const manual = state.manual
    const sceneInfo = state.sceneInfo
    if (!rng || !manual || !sceneInfo) return

    errorCountRef.current += 1

    try {
      const idx = state.currentModuleIndex
      let config: ModuleConfig
      let answer: ModuleAnswer
      if (idx === 0) {
        const result = generateWire(rng, manual.modules.wire_routing.rules, sceneInfo)
        config = result.config; answer = result.answer
      } else if (idx === 1) {
        const result = generateDial(rng, manual.modules.symbol_dial, sceneInfo)
        config = result.config; answer = result.answer
      } else if (idx === 2) {
        const result = generateButton(rng, manual.modules.button.rules, sceneInfo)
        config = result.config; answer = result.answer
      } else {
        const result = generateKeypad(rng, manual.modules.keypad, sceneInfo)
        config = result.config; answer = result.answer
      }
      dispatch({ type: 'REGENERATE_MODULE', config, answer })
    } catch (genErr) {
      console.error('Generator exhaustion during error regeneration:', genErr)
      dispatch({
        type: 'LOAD_ERROR',
        message: 'Puzzle generation failed. Please restart.',
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

    if (idx === 0) return <WireModule config={config as never} answer={answer as never} {...commonProps} />
    if (idx === 1) return <DialModule config={config as never} answer={answer as never} {...commonProps} />
    if (idx === 2) return <ButtonModule config={config as never} answer={answer as never} {...commonProps} />
    if (idx === 3) return <KeypadModule config={config as never} answer={answer as never} {...commonProps} />
    return null
  }

  // LOADING state
  if (state.status === 'LOADING') {
    return (
      <main className={styles.page}>
        <div className={styles.overlay}>
          {state.errorMessage ? (
            <>
              <p className={styles.errorText}>{state.errorMessage}</p>
              <button className={styles.retryBtn} onClick={() => window.location.reload()}>
                RETRY
              </button>
              <Link to="/" className={styles.homeLink}>← Go Home</Link>
            </>
          ) : (
            <p className={styles.loadingText}>LOADING MANUAL…</p>
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
          <p className={styles.readyText}>READY?</p>
          <button
            className={styles.startBtn}
            onClick={() => dispatch({ type: 'START_GAME' })}
          >
            START
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
          <div>{mode === 'daily' ? 'DAILY' : 'PRACTICE'}</div>
          <div>{mode === 'daily' ? `ATTEMPT #${state.attemptNumber}` : 'LOCAL PRACTICE'}</div>
        </div>
      </div>

      <div className={styles.moduleArea}>
        <div>
          <p className={styles.moduleLabel}>
            {MODULE_NAMES[state.currentModuleIndex]}
          </p>
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
          <p className={styles.defusedText}>DEFUSED</p>
        </div>
      )}
    </main>
  )
}
