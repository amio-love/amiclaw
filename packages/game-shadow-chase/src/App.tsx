import { useEffect, useRef, useState } from 'react'

import { CommandBar } from './components/CommandBar'
import { CompanionStatus } from './components/CompanionStatus'
import { GameBoard } from './components/GameBoard'
import { Hud } from './components/Hud'
import { MoveControls } from './components/MoveControls'
import { ResultScreen } from './components/ResultScreen'
import { StartScreen } from './components/StartScreen'
import type { Difficulty } from './engine/types'
import { handoffSettlement } from './settlement/settlement-client'
import { createGameStore } from './store/game-store'
import { useGameStore } from './store/react'

export function App() {
  const [difficulty, setDifficulty] = useState<Difficulty>('standard')
  const [mapId, setMapId] = useState('courtyard')
  const [started, setStarted] = useState(false)
  const [store, setStore] = useState(() => createGameStore({ difficulty, mapId }))
  const state = useGameStore(store)
  const settledRuns = useRef(new Set<string>())

  useEffect(() => {
    if (!started) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      store.setHeldKey(event.code, true)
      if (event.code.startsWith('Arrow')) event.preventDefault()
    }
    const handleKeyUp = (event: KeyboardEvent) => store.setHeldKey(event.code, false)
    const clearInput = () => store.clearInput()
    const handleVisibility = () => store.setHidden(document.hidden)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', handleVisibility)
      store.destroy()
    }
  }, [started, store])

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

  if (!started) {
    return (
      <StartScreen
        difficulty={difficulty}
        mapId={mapId}
        onDifficultyChange={setDifficulty}
        onMapChange={setMapId}
        onStart={() => {
          store.destroy()
          const nextStore = createGameStore({ difficulty, mapId })
          setStore(nextStore)
          setStarted(true)
          nextStore.start()
        }}
      />
    )
  }

  if (state.phase !== 'running') {
    return <ResultScreen state={state} onRestart={() => store.restart()} />
  }

  return (
    <main className="game-shell">
      <Hud state={state} />
      <div className="play-layout">
        <section className="board-panel">
          <GameBoard
            state={state}
            onTarget={(target) => store.dispatch({ type: 'player-target', target })}
          />
          <CompanionStatus state={state} />
        </section>
        <aside className="control-panel">
          <CommandBar
            state={state}
            onCommand={(command) => store.dispatch({ type: 'companion-command', command })}
            onSwap={() => store.dispatch({ type: 'swap' })}
          />
          <MoveControls
            onMove={(direction) => store.dispatch({ type: 'player-move', direction })}
          />
          <p className="keyboard-hint">Keyboard: WASD or arrow keys</p>
        </aside>
      </div>
    </main>
  )
}

export default App
