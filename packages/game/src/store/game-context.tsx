import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import type { ModuleConfig, ModuleAnswer, Manual, SceneInfo } from '@shared/manual-schema'
import { clearPersistedState, loadPersistedState, savePersistedState } from './persistence'

// ---------------------------------------------------------------------------
// Status & State
// ---------------------------------------------------------------------------

export type GameStatus =
  | 'LOADING'
  | 'READY'
  | 'PLAYING'
  | 'MODULE_COMPLETE'
  | 'ALL_COMPLETE'
  | 'RESULT'

export type GameMode = 'practice' | 'daily'

export interface ModuleStat {
  moduleType: string
  timeMs: number // time spent on this module in ms
  errorCount: number // number of wrong answers before solving
}

export type LoadErrorKind = 'not_published' | 'generic'

export interface GameState {
  status: GameStatus
  mode: GameMode
  manual: Manual | null
  manualUrl: string | null
  sceneInfo: SceneInfo | null
  moduleConfigs: (ModuleConfig | null)[] // length 4
  moduleAnswers: (ModuleAnswer | null)[] // length 4
  currentModuleIndex: number
  moduleStats: ModuleStat[]
  /** Wall-clock timestamp (Date.now()) when the whole run started. */
  totalStartTime: number | null
  /** Wall-clock timestamp (Date.now()) when the last module was solved. */
  totalEndTime: number | null
  /** Wall-clock timestamp when the current module entered PLAYING. */
  currentModuleStartTime: number | null
  /** How many wrong attempts the player has made on the current module. */
  currentModuleErrorCount: number
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
  | { type: 'REGENERATE_MODULE'; config: ModuleConfig; answer: ModuleAnswer }
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
  moduleConfigs: [null, null, null, null],
  moduleAnswers: [null, null, null, null],
  currentModuleIndex: 0,
  moduleStats: [],
  totalStartTime: null,
  totalEndTime: null,
  currentModuleStartTime: null,
  currentModuleErrorCount: 0,
  errorMessage: null,
  errorKind: null,
  attemptNumber: 1,
  rngSeed: 0,
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_LOADING':
      return {
        ...INITIAL_STATE,
        status: 'LOADING',
        mode: action.mode,
        manualUrl: action.manualUrl,
        attemptNumber: action.attemptNumber,
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

    case 'LOAD_ERROR':
      return {
        ...state,
        status: 'LOADING', // stays on loading screen, shows error
        errorMessage: action.message,
        errorKind: action.kind ?? 'generic',
      }

    case 'START_GAME': {
      if (import.meta.env.DEV) {
        const missingConfig = state.moduleConfigs.some((c) => c === null)
        if (missingConfig) {
          throw new Error('START_GAME dispatched while some moduleConfigs are null')
        }
      }
      const now = Date.now()
      return {
        ...state,
        status: 'PLAYING',
        currentModuleIndex: 0,
        moduleStats: [],
        totalStartTime: now,
        totalEndTime: null,
        currentModuleStartTime: now,
        currentModuleErrorCount: 0,
      }
    }

    case 'MODULE_COMPLETE': {
      const now = Date.now()
      const startedAt = state.currentModuleStartTime ?? now
      return {
        ...state,
        status: 'MODULE_COMPLETE',
        moduleStats: [
          ...state.moduleStats,
          {
            moduleType: action.moduleType,
            timeMs: now - startedAt,
            errorCount: state.currentModuleErrorCount,
          },
        ],
      }
    }

    case 'NEXT_MODULE': {
      const next = state.currentModuleIndex + 1
      const now = Date.now()
      if (next >= 4) {
        return {
          ...state,
          status: 'ALL_COMPLETE',
          currentModuleIndex: next,
          totalEndTime: now,
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

    case 'ALL_MODULES_COMPLETE':
      return {
        ...state,
        status: 'RESULT',
        totalEndTime: state.totalEndTime ?? Date.now(),
      }

    case 'REGENERATE_MODULE': {
      const configs = [...state.moduleConfigs] as (ModuleConfig | null)[]
      const answers = [...state.moduleAnswers] as (ModuleAnswer | null)[]
      configs[state.currentModuleIndex] = action.config
      answers[state.currentModuleIndex] = action.answer
      return {
        ...state,
        moduleConfigs: configs,
        moduleAnswers: answers,
        currentModuleErrorCount: state.currentModuleErrorCount + 1,
      }
    }

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
 * the same session storage used by the submission retry flow. PLAYING and
 * MODULE_COMPLETE are the critical cases: those are where a dropped refresh
 * would cost the player their timer and per-module stats.
 */
const PERSISTABLE_STATUSES: GameStatus[] = [
  'READY',
  'PLAYING',
  'MODULE_COMPLETE',
  'ALL_COMPLETE',
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
