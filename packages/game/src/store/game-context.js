import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useReducer } from 'react';
// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------
const INITIAL_STATE = {
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
    errorMessage: null,
    attemptNumber: 1,
    rngSeed: 0,
};
// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------
function gameReducer(state, action) {
    switch (action.type) {
        case 'START_LOADING':
            return {
                ...INITIAL_STATE,
                status: 'LOADING',
                mode: action.mode,
                manualUrl: action.manualUrl,
                attemptNumber: state.attemptNumber,
            };
        case 'MANUAL_LOADED':
            return {
                ...state,
                status: 'READY',
                manual: action.manual,
                sceneInfo: action.sceneInfo,
                moduleConfigs: action.moduleConfigs,
                moduleAnswers: action.moduleAnswers,
                rngSeed: action.rngSeed,
                errorMessage: null,
            };
        case 'LOAD_ERROR':
            return {
                ...state,
                status: 'LOADING', // stays on loading screen, shows error
                errorMessage: action.message,
            };
        case 'START_GAME': {
            if (import.meta.env.DEV) {
                const missingConfig = state.moduleConfigs.some(c => c === null);
                if (missingConfig) {
                    throw new Error('START_GAME dispatched while some moduleConfigs are null');
                }
            }
            return {
                ...state,
                status: 'PLAYING',
                currentModuleIndex: 0,
                moduleStats: [],
                totalStartTime: performance.now(),
                totalEndTime: null,
            };
        }
        case 'MODULE_COMPLETE':
            return {
                ...state,
                status: 'MODULE_COMPLETE',
                moduleStats: [
                    ...state.moduleStats,
                    {
                        moduleType: action.moduleType,
                        timeMs: action.timeMs,
                        errorCount: action.errorCount,
                    },
                ],
            };
        case 'NEXT_MODULE': {
            const next = state.currentModuleIndex + 1;
            if (next >= 4) {
                return {
                    ...state,
                    status: 'ALL_COMPLETE',
                    currentModuleIndex: next,
                    totalEndTime: performance.now(),
                };
            }
            return {
                ...state,
                status: 'PLAYING',
                currentModuleIndex: next,
            };
        }
        case 'ALL_MODULES_COMPLETE':
            return {
                ...state,
                status: 'RESULT',
                totalEndTime: state.totalEndTime ?? performance.now(),
            };
        case 'REGENERATE_MODULE': {
            const configs = [...state.moduleConfigs];
            const answers = [...state.moduleAnswers];
            configs[state.currentModuleIndex] = action.config;
            answers[state.currentModuleIndex] = action.answer;
            return {
                ...state,
                moduleConfigs: configs,
                moduleAnswers: answers,
            };
        }
        case 'RESET':
            return {
                ...INITIAL_STATE,
                attemptNumber: state.attemptNumber + 1,
                mode: state.mode,
                manualUrl: state.manualUrl,
            };
        default:
            return state;
    }
}
export const GameContext = createContext(null);
export function GameProvider({ children }) {
    const [state, dispatch] = useReducer(gameReducer, INITIAL_STATE);
    return (_jsx(GameContext.Provider, { value: { state, dispatch }, children: children }));
}
export function useGame() {
    const ctx = useContext(GameContext);
    if (!ctx) {
        throw new Error('useGame must be used inside <GameProvider>');
    }
    return ctx;
}
