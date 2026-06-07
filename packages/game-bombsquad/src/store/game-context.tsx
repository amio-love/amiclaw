import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import type { ModuleConfig, ModuleAnswer, Manual, SceneInfo } from '@shared/manual-schema'
import { clearPersistedState, loadPersistedState, savePersistedState } from './persistence'
import { logEvent } from '@/utils/event-log'

// ---------------------------------------------------------------------------
// Status & State
// ---------------------------------------------------------------------------

export type GameStatus =
  | 'LOADING'
  | 'READY'
  | 'PLAYING'
  | 'MODULE_COMPLETE'
  | 'ALL_COMPLETE'
  | 'EXPLODING'
  | 'RESULT'

export type GameMode = 'practice' | 'daily'

/** A module kind — drives the per-mode module sequence. */
export type ModuleKind = 'wire' | 'dial' | 'button' | 'keypad'

/**
 * Terminal outcome of a run. The result page branches on this:
 * - `defused`           daily: every module solved → success + leaderboard
 * - `exploded`          daily: 3 strikes → failure (the ONLY daily fail path)
 * - `practice-cleared`  practice: every module solved → neutral success
 * - `practice-timeout`  practice: hit the 1h hard cap → neutral, no explosion
 * - `daily-timeout`     daily: hit the 1h hard cap unsolved → neutral, no
 *                       explosion, no leaderboard submit (run never defused)
 *
 * The timer counts UP (a stopwatch): faster runs rank higher. Time is a score,
 * not a detonator — only a 3rd strike ends a daily run in failure.
 */
export type GameOutcome =
  | 'defused'
  | 'exploded'
  | 'practice-cleared'
  | 'practice-timeout'
  | 'daily-timeout'

/** Ordered module kinds per mode. Length decides how many modules a run has. */
export const MODULE_SEQUENCE: Record<GameMode, ModuleKind[]> = {
  daily: ['wire', 'dial', 'button', 'keypad'],
  practice: ['wire', 'keypad'],
}

/**
 * Hard time cap per mode, in milliseconds. The timer counts UP from zero; this
 * is the upper bound at which a run ends neutrally (no explosion in either
 * mode). Both modes share a 1-hour cap, aligned with the backend's
 * `MAX_GAME_TIME_MS` so a displayed elapsed time can never exceed the
 * submittable range. The field that stores this per run is `timeBudgetMs`
 * (kept for persistence-shape stability); its meaning is now "elapsed hard
 * cap", not "countdown budget".
 */
export const TIME_BUDGET_MS: Record<GameMode, number> = {
  daily: 3_600_000, // 1 hour hard cap
  practice: 3_600_000, // 1 hour hard cap
}

/** Daily challenge detonates on the 3rd strike. */
export const MAX_STRIKES = 3

export interface ModuleStat {
  moduleType: string
  timeMs: number // time spent on this module in ms
  errorCount: number // number of wrong answers before solving
}

export type LoadErrorKind = 'not_published' | 'generic' | 'yaml_parse' | 'network'

export interface GameState {
  status: GameStatus
  mode: GameMode
  manual: Manual | null
  manualUrl: string | null
  sceneInfo: SceneInfo | null
  /** Module kinds for this run, in order. Derived from MODULE_SEQUENCE[mode]. */
  moduleSequence: ModuleKind[]
  moduleConfigs: (ModuleConfig | null)[] // length === moduleSequence.length
  moduleAnswers: (ModuleAnswer | null)[] // length === moduleSequence.length
  currentModuleIndex: number
  moduleStats: ModuleStat[]
  /** Wall-clock timestamp (Date.now()) when the whole run started. */
  totalStartTime: number | null
  /** Wall-clock timestamp (Date.now()) when the run ended (won or lost). */
  totalEndTime: number | null
  /** Wall-clock timestamp when the current module entered PLAYING. */
  currentModuleStartTime: number | null
  /** How many wrong attempts the player has made on the current module. */
  currentModuleErrorCount: number
  /** Daily-challenge cumulative wrong answers across the whole run. */
  strikeCount: number
  /**
   * Elapsed-time hard cap for this run, set on START_GAME from TIME_BUDGET_MS.
   * The timer counts up toward this bound; reaching it ends the run neutrally.
   * Field name kept as `timeBudgetMs` for persistence-shape stability.
   */
  timeBudgetMs: number
  /** Terminal outcome, written when the run resolves. Null while in flight. */
  outcome: GameOutcome | null
  errorMessage: string | null
  errorKind: LoadErrorKind | null
  attemptNumber: number
  rngSeed: number
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'START_LOADING'; mode: GameMode; manualUrl: string; attemptNumber: number }
  | {
      type: 'MANUAL_LOADED'
      manual: Manual
      sceneInfo: SceneInfo
      moduleConfigs: ModuleConfig[]
      moduleAnswers: ModuleAnswer[]
      rngSeed: number
    }
  | { type: 'LOAD_ERROR'; message: string; kind?: LoadErrorKind }
  | { type: 'START_GAME' }
  | { type: 'MODULE_COMPLETE'; moduleType: string }
  | { type: 'NEXT_MODULE' }
  | { type: 'ALL_MODULES_COMPLETE' }
  | { type: 'MODULE_ERROR' }
  | { type: 'TIME_EXPIRED' }
  | { type: 'EXPLOSION_DONE' }
  | { type: 'RESET' }

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: GameState = {
  status: 'LOADING',
  mode: 'practice',
  manual: null,
  manualUrl: null,
  sceneInfo: null,
  moduleSequence: [],
  moduleConfigs: [],
  moduleAnswers: [],
  currentModuleIndex: 0,
  moduleStats: [],
  totalStartTime: null,
  totalEndTime: null,
  currentModuleStartTime: null,
  currentModuleErrorCount: 0,
  strikeCount: 0,
  timeBudgetMs: 0,
  outcome: null,
  errorMessage: null,
  errorKind: null,
  attemptNumber: 1,
  rngSeed: 0,
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_LOADING': {
      const sequence = MODULE_SEQUENCE[action.mode]
      return {
        ...INITIAL_STATE,
        status: 'LOADING',
        mode: action.mode,
        manualUrl: action.manualUrl,
        attemptNumber: action.attemptNumber,
        moduleSequence: sequence,
        moduleConfigs: sequence.map(() => null),
        moduleAnswers: sequence.map(() => null),
      }
    }

    case 'MANUAL_LOADED':
      return {
        ...state,
        status: 'READY',
        manual: action.manual,
        sceneInfo: action.sceneInfo,
        moduleConfigs: action.moduleConfigs as (ModuleConfig | null)[],
        moduleAnswers: action.moduleAnswers as (ModuleAnswer | null)[],
        rngSeed: action.rngSeed,
        errorMessage: null,
        errorKind: null,
      }

    // Note on logEvent calls inside this reducer: in dev, React.StrictMode
    // double-invokes reducers to detect impurity, so each event below will
    // appear twice in the local browser console. Production builds invoke
    // reducers once, so Cloudflare Pages logs (the actual metric source) see
    // exactly one event per state transition. If dev-mode noise becomes a
    // problem we can gate calls on `import.meta.env.PROD` or relocate to an
    // effect — for now the production guarantee is what matters.
    case 'LOAD_ERROR': {
      const kind = action.kind ?? 'generic'
      logEvent('manual_load_failed', {
        kind,
        message: action.message,
        mode: state.mode,
      })
      return {
        ...state,
        status: 'LOADING', // stays on loading screen, shows error
        errorMessage: action.message,
        errorKind: kind,
      }
    }

    case 'START_GAME': {
      // Idempotency guard: START_GAME only starts a run from READY. The GamePage
      // auto-start effect dispatches it on entering READY, and React StrictMode
      // can double-invoke that effect — without this guard the second dispatch
      // would reset a now-live run (currentModuleIndex:0, totalStartTime:now,
      // strikeCount:0, a second game_start event). Mirrors the
      // MODULE_COMPLETE / MODULE_ERROR / NEXT_MODULE status guards. Play Again
      // never reaches here from PLAYING — it dispatches RESET, then a fresh
      // LOADING → MANUAL_LOADED → READY cycle re-arms this case.
      if (state.status !== 'READY') return state
      if (import.meta.env.DEV) {
        const missingConfig = state.moduleConfigs.some((c) => c === null)
        if (missingConfig) {
          throw new Error('START_GAME dispatched while some moduleConfigs are null')
        }
      }
      const now = Date.now()
      logEvent('game_start', {
        mode: state.mode,
        attemptNumber: state.attemptNumber,
        rngSeed: state.rngSeed,
      })
      return {
        ...state,
        status: 'PLAYING',
        currentModuleIndex: 0,
        moduleStats: [],
        totalStartTime: now,
        totalEndTime: null,
        currentModuleStartTime: now,
        currentModuleErrorCount: 0,
        strikeCount: 0,
        timeBudgetMs: TIME_BUDGET_MS[state.mode],
        outcome: null,
      }
    }

    case 'MODULE_COMPLETE': {
      // Terminal-state guard: only a live run can complete a module. Once the
      // run has left PLAYING — EXPLODING after a 3rd strike, or already at
      // RESULT — a racing onComplete tap landing inside the 1.4s
      // explosion-animation window must not revive an already-lost run into a
      // win. Same guard shape as MODULE_ERROR / NEXT_MODULE.
      if (state.status !== 'PLAYING') return state
      const now = Date.now()
      const startedAt = state.currentModuleStartTime ?? now
      const timeMs = now - startedAt
      logEvent('module_solve', {
        moduleType: action.moduleType,
        moduleIndex: state.currentModuleIndex,
        timeMs,
        errorCount: state.currentModuleErrorCount,
      })
      // Last-module win lock: the instant the final module is solved the run
      // is won — stamp totalEndTime + outcome here, before the 800ms
      // MODULE_COMPLETE → ALL_COMPLETE auto-advance window. A stopwatch that
      // reaches the hard cap inside that window then cannot reclassify an
      // already-won run (TIME_EXPIRED no-ops once totalEndTime / outcome is
      // set, and the GamePage cap-detection effect is short-circuited by
      // totalEndTime). The cap-out is neutral anyway, so this race could no
      // longer produce a mis-classified loss — the lock is kept as defensive
      // belt-and-braces against any future non-neutral cap behaviour.
      const isLastModule = state.currentModuleIndex >= state.moduleConfigs.length - 1
      return {
        ...state,
        status: 'MODULE_COMPLETE',
        moduleStats: [
          ...state.moduleStats,
          {
            moduleType: action.moduleType,
            timeMs,
            errorCount: state.currentModuleErrorCount,
          },
        ],
        totalEndTime: isLastModule ? now : state.totalEndTime,
        outcome: isLastModule
          ? state.mode === 'daily'
            ? 'defused'
            : 'practice-cleared'
          : state.outcome,
      }
    }

    case 'NEXT_MODULE': {
      // Defensive: NEXT_MODULE is only ever dispatched from the
      // MODULE_COMPLETE 800ms auto-advance effect. Guarding the status keeps a
      // stale dispatch from clobbering a terminal state (e.g. EXPLODING).
      if (state.status !== 'MODULE_COMPLETE') return state
      const next = state.currentModuleIndex + 1
      const now = Date.now()
      if (next >= state.moduleConfigs.length) {
        return {
          ...state,
          status: 'ALL_COMPLETE',
          currentModuleIndex: next,
          // totalEndTime is already stamped by MODULE_COMPLETE on the last
          // module; keep it rather than overwriting with a later timestamp.
          totalEndTime: state.totalEndTime ?? now,
          currentModuleStartTime: null,
          currentModuleErrorCount: 0,
        }
      }
      return {
        ...state,
        status: 'PLAYING',
        currentModuleIndex: next,
        currentModuleStartTime: now,
        currentModuleErrorCount: 0,
      }
    }

    case 'ALL_MODULES_COMPLETE': {
      const endedAt = state.totalEndTime ?? Date.now()
      const totalTimeMs = state.totalStartTime !== null ? endedAt - state.totalStartTime : 0
      logEvent('game_complete', {
        totalTimeMs,
        attemptNumber: state.attemptNumber,
        moduleStats: state.moduleStats,
        mode: state.mode,
      })
      return {
        ...state,
        status: 'RESULT',
        totalEndTime: endedAt,
        outcome: state.outcome ?? (state.mode === 'daily' ? 'defused' : 'practice-cleared'),
      }
    }

    case 'MODULE_ERROR': {
      // Only meaningful during active play. Practice never fails: a wrong
      // answer just bumps the per-module error count (kept for the recap),
      // the puzzle is untouched, and the player retries in place. Daily
      // accumulates strikes — the 3rd detonates the bomb.
      if (state.status !== 'PLAYING') return state
      if (state.mode === 'practice') {
        return { ...state, currentModuleErrorCount: state.currentModuleErrorCount + 1 }
      }
      const nextStrikes = state.strikeCount + 1
      if (nextStrikes >= MAX_STRIKES) {
        // Third strike — the bomb detonates. Emit failure telemetry so the
        // beta dashboard can tell a strike-out apart from a timeout. `now` is
        // shared with `totalEndTime` below so the logged run duration matches
        // the recorded run end exactly.
        const now = Date.now()
        const totalTimeMs = state.totalStartTime !== null ? now - state.totalStartTime : 0
        logEvent('game_failed_strikeout', {
          mode: state.mode,
          totalTimeMs,
          attemptNumber: state.attemptNumber,
          strikeCount: nextStrikes,
          moduleStats: state.moduleStats,
          moduleIndex: state.currentModuleIndex,
        })
        return {
          ...state,
          status: 'EXPLODING',
          strikeCount: nextStrikes,
          currentModuleErrorCount: state.currentModuleErrorCount + 1,
          totalEndTime: now,
          outcome: 'exploded',
        }
      }
      return {
        ...state,
        strikeCount: nextStrikes,
        currentModuleErrorCount: state.currentModuleErrorCount + 1,
      }
    }

    case 'TIME_EXPIRED': {
      // The stopwatch reached the 1-hour hard cap. No-op once the run is
      // already resolved — this is what protects the MODULE_COMPLETE →
      // ALL_COMPLETE auto-advance window of a freshly-won last module (see
      // MODULE_COMPLETE above).
      if (state.status !== 'PLAYING' && state.status !== 'MODULE_COMPLETE') return state
      if (state.totalEndTime !== null || state.outcome !== null) return state
      const now = Date.now()
      // Hitting the cap NEVER detonates the bomb — in either mode it ends the
      // run neutrally. Time is a score, not a detonator; the only daily failure
      // path is the 3-strike rule in MODULE_ERROR above.
      if (state.mode === 'daily') {
        // A neutral `game_ended_timeout` is logged on the daily cap-out (after
        // the two terminal-state guards, so a no-op never logs and a real
        // transition logs exactly once) so the beta dashboard can still count
        // daily cap-outs apart from clean completes — without treating them as
        // failures. Practice cap-outs stay silent, as the timeout path always
        // was for practice.
        const totalTimeMs = state.totalStartTime !== null ? now - state.totalStartTime : 0
        logEvent('game_ended_timeout', {
          mode: state.mode,
          totalTimeMs,
          attemptNumber: state.attemptNumber,
          strikeCount: state.strikeCount,
          moduleStats: state.moduleStats,
          moduleIndex: state.currentModuleIndex,
        })
        return { ...state, status: 'RESULT', totalEndTime: now, outcome: 'daily-timeout' }
      }
      return { ...state, status: 'RESULT', totalEndTime: now, outcome: 'practice-timeout' }
    }

    case 'EXPLOSION_DONE':
      // The explosion animation finished; move to the failure result page.
      return state.status === 'EXPLODING' ? { ...state, status: 'RESULT' } : state

    case 'RESET':
      return { ...INITIAL_STATE }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface GameContextValue {
  state: GameState
  dispatch: React.Dispatch<GameAction>
}

export const GameContext = createContext<GameContextValue | null>(null)

/**
 * Statuses worth persisting across an accidental refresh. LOADING isn't —
 * the mount effect will simply reload — and RESULT can be regenerated from
 * the same session storage used by the submission retry flow. PLAYING,
 * MODULE_COMPLETE and EXPLODING are the critical cases: those are where a
 * dropped refresh would cost the player their timer and per-module stats.
 */
const PERSISTABLE_STATUSES: GameStatus[] = [
  'READY',
  'PLAYING',
  'MODULE_COMPLETE',
  'ALL_COMPLETE',
  'EXPLODING',
  'RESULT',
]

export function GameProvider({ children }: { children: ReactNode }) {
  // Lazy initializer reads the persisted state once on mount so a refresh
  // during PLAYING / MODULE_COMPLETE restores scene, configs, stats, timer.
  const [state, dispatch] = useReducer(gameReducer, INITIAL_STATE, (initial) => {
    const persisted = loadPersistedState()
    if (persisted && PERSISTABLE_STATUSES.includes(persisted.status)) {
      return persisted
    }
    return initial
  })

  // Mirror every state transition back into sessionStorage. Clearing on
  // RESET (status === 'LOADING' and no manual loaded) keeps stale runs from
  // haunting a brand-new game in the same tab.
  useEffect(() => {
    if (state.status === 'LOADING' && state.manual === null) {
      clearPersistedState()
    } else if (PERSISTABLE_STATUSES.includes(state.status)) {
      savePersistedState(state)
    }
  }, [state])

  return <GameContext.Provider value={{ state, dispatch }}>{children}</GameContext.Provider>
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext)
  if (!ctx) {
    throw new Error('useGame must be used inside <GameProvider>')
  }
  return ctx
}
