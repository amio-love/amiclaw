import { useRef, useCallback } from 'react'
import { useGame } from '@/store/game-context'
import type { ModuleConfig, ModuleAnswer } from '@shared/manual-schema'

/**
 * Manages per-module timing and error counting.
 * Call startModule() when a module becomes active.
 * Call completeModule(type) on success — dispatches MODULE_COMPLETE.
 * Call errorModule(config, answer) on wrong answer — increments reset count
 *   and dispatches REGENERATE_MODULE.
 */
export function useGameSession() {
  const { state, dispatch } = useGame()
  const moduleStartRef = useRef<number | null>(null)
  const errorCountRef = useRef(0)

  const startModule = useCallback(() => {
    moduleStartRef.current = performance.now()
    errorCountRef.current = 0
  }, [])

  const completeModule = useCallback((moduleType: string) => {
    const startTime = moduleStartRef.current ?? performance.now()
    const timeMs = performance.now() - startTime
    dispatch({ type: 'MODULE_COMPLETE', timeMs, errorCount: errorCountRef.current, moduleType })
  }, [dispatch])

  const errorModule = useCallback((config: ModuleConfig, answer: ModuleAnswer) => {
    errorCountRef.current += 1
    dispatch({ type: 'REGENERATE_MODULE', config, answer })
  }, [dispatch])

  return {
    currentModuleIndex: state.currentModuleIndex,
    startModule,
    completeModule,
    errorModule,
  }
}
