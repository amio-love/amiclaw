/**
 * Top-level screen state machine: level select ↔ playing. No router — a single
 * screen with two states keeps the standalone probe minimal. The GameScreen is
 * keyed by (level, side, run) so restart / next-level / side-swap remount a
 * fresh store.
 */

import { useState } from 'react'
import { levelByIndex, LEVELS } from './game/levels'
import type { Side } from './game/types'
import { GameScreen } from './ui/GameScreen'
import { LevelSelect } from './ui/LevelSelect'

type View = { screen: 'select' } | { screen: 'play'; levelIndex: number; side: Side; run: number }

export function App() {
  const [view, setView] = useState<View>({ screen: 'select' })

  if (view.screen === 'select') {
    return (
      <LevelSelect
        onStart={(levelIndex, side) =>
          setView({ screen: 'play', levelIndex, side, run: Date.now() })
        }
      />
    )
  }

  const level = levelByIndex(view.levelIndex)
  if (!level) {
    return (
      <LevelSelect
        onStart={(levelIndex, side) =>
          setView({ screen: 'play', levelIndex, side, run: Date.now() })
        }
      />
    )
  }
  const hasNext = LEVELS.some((l) => l.index === view.levelIndex + 1)

  return (
    <GameScreen
      key={`${view.levelIndex}-${view.side}-${view.run}`}
      level={level}
      side={view.side}
      hasNext={hasNext}
      onExit={() => setView({ screen: 'select' })}
      onReplay={() => setView({ ...view, run: Date.now() })}
      onNext={() =>
        setView({
          screen: 'play',
          levelIndex: view.levelIndex + 1,
          side: view.side,
          run: Date.now(),
        })
      }
    />
  )
}
