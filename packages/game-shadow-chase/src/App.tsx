import { useCallback, useEffect, useRef, useState } from 'react'

import { GameBoard } from './components/GameBoard'
import { Hud } from './components/Hud'
import { InputFeedback } from './components/InputFeedback'
import { MoveControls } from './components/MoveControls'
import { PlanningScreen } from './components/PlanningScreen'
import { ResultScreen } from './components/ResultScreen'
import { StartScreen } from './components/StartScreen'
import { StrategyPanel } from './components/StrategyPanel'
import type { CompanionIntent, Difficulty } from './engine/types'
import { createPlanningController } from './planning/planning-controller'
import { usePlanningController } from './planning/react'
import { handoffSettlement } from './settlement/settlement-client'
import { createGameStore, type GameStore } from './store/game-store'
import { useGameStore } from './store/react'
import { ShadowVoiceRuntime } from './voice/ShadowVoiceRuntime'
import {
  useShadowChaseVoice,
  type ShadowVoiceSource,
  type ShadowVoiceView,
} from './voice/useShadowChaseVoice'

type SessionPhase = 'setup' | 'planning' | 'running'

export function App({ voiceSource }: { voiceSource?: ShadowVoiceSource | null }) {
  const [difficulty, setDifficulty] = useState<Difficulty>('standard')
  const [mapId, setMapId] = useState('courtyard')
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('setup')
  const [store, setStore] = useState(() => createGameStore({ difficulty, mapId }))
  const [planning] = useState(() => createPlanningController())
  const planningState = usePlanningController(planning)
  const state = useGameStore(store)
  const [pendingStrategy, setPendingStrategy] = useState<CompanionIntent>('follow')
  const pendingStrategyRef = useRef<CompanionIntent>('follow')
  const settledRuns = useRef(new Set<string>())

  const selectStrategy = useCallback(
    (intent: CompanionIntent) => {
      if (sessionPhase === 'planning') {
        pendingStrategyRef.current = intent
        setPendingStrategy(intent)
      } else if (sessionPhase === 'running') {
        store.dispatch({ type: 'companion-command', command: intent })
      }
    },
    [sessionPhase, store]
  )
  const hasInjectedVoice = voiceSource !== undefined
  const injectedVoice = useShadowChaseVoice(voiceSource ?? null, selectStrategy)
  const stopInjectedVoice = injectedVoice.stop

  const beginPlanning = useCallback(
    (runStore: GameStore) => {
      pendingStrategyRef.current = 'follow'
      setPendingStrategy('follow')
      setSessionPhase('planning')
      planning.begin(() => {
        runStore.dispatch({
          type: 'companion-command',
          command: pendingStrategyRef.current,
        })
        runStore.start()
        setSessionPhase('running')
      })
    },
    [planning]
  )

  useEffect(() => () => store.destroy(), [store])
  useEffect(() => () => planning.destroy(), [planning])

  useEffect(() => {
    if (sessionPhase !== 'running') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      store.setHeldKey(event.code, true)
      if (event.code.startsWith('Arrow')) event.preventDefault()
    }
    const handleKeyUp = (event: KeyboardEvent) => store.setHeldKey(event.code, false)
    const clearInput = () => store.clearInput()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearInput)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearInput)
      store.clearInput()
    }
  }, [sessionPhase, store])

  useEffect(() => {
    if (sessionPhase === 'setup') return
    const handleVisibility = () => {
      if (sessionPhase === 'planning') {
        planning.setHidden(document.hidden)
        if (document.hidden && hasInjectedVoice) stopInjectedVoice?.()
      } else {
        store.setHidden(document.hidden)
        if (document.hidden && hasInjectedVoice) stopInjectedVoice?.()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [hasInjectedVoice, planning, sessionPhase, stopInjectedVoice, store])

  useEffect(() => {
    if (!state.terminal || settledRuns.current.has(state.runId)) return
    settledRuns.current.add(state.runId)
    handoffSettlement({
      version: 1,
      runId: state.runId,
      outcome: state.terminal.outcome,
      durationTicks: state.tick,
    })
  }, [state])

  if (sessionPhase === 'setup') {
    return (
      <StartScreen
        difficulty={difficulty}
        mapId={mapId}
        planningSeconds={planningState.selectedSeconds}
        onDifficultyChange={setDifficulty}
        onMapChange={setMapId}
        onPlanningSecondsChange={planning.setDuration}
        onStart={() => {
          const nextStore = createGameStore({ difficulty, mapId })
          setStore(nextStore)
          beginPlanning(nextStore)
        }}
      />
    )
  }

  const isPlanning = sessionPhase === 'planning'
  const activeStrategy = isPlanning ? pendingStrategy : state.command.intent
  const renderSession = (voice: ShadowVoiceView) => {
    if (state.phase !== 'running') {
      return (
        <ResultScreen
          state={state}
          onRestart={() => {
            store.prepareNextRun()
            beginPlanning(store)
          }}
        />
      )
    }

    return (
      <main className="game-shell">
        {isPlanning ? (
          <PlanningScreen
            planning={planningState}
            onDurationChange={planning.setDuration}
            onStartNow={planning.startNow}
          />
        ) : (
          <Hud state={state} />
        )}
        <div className="play-layout">
          <section className="board-panel">
            <GameBoard
              state={state}
              interactive={!isPlanning}
              onTarget={(target) => store.dispatch({ type: 'player-target', target })}
            />
            <InputFeedback feedback={store.getInputFeedback()} currentTick={state.tick} />
          </section>
          <aside className="control-panel">
            <StrategyPanel
              state={state}
              activeIntent={activeStrategy}
              planning={isPlanning}
              voice={voice}
              onStrategy={selectStrategy}
              onSwap={() => store.dispatch({ type: 'swap' })}
            />
            {!isPlanning && (
              <>
                <MoveControls
                  onMove={(direction) => store.dispatch({ type: 'player-move', direction })}
                />
                <p className="keyboard-hint">键盘可用 WASD 或方向键</p>
              </>
            )}
          </aside>
        </div>
      </main>
    )
  }

  if (hasInjectedVoice) return renderSession(injectedVoice)

  return (
    <ShadowVoiceRuntime
      key={state.runId}
      state={state}
      phase={isPlanning ? 'planning' : 'running'}
      activeStrategy={activeStrategy}
      onStrategy={selectStrategy}
    >
      {renderSession}
    </ShadowVoiceRuntime>
  )
}

export default App
