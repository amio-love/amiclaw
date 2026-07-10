import { useRef } from 'react'

import { OPENING_GRACE_TICKS } from '../engine/config'
import { getMap } from '../engine/maps'
import type { Coordinate, SimulationState } from '../engine/types'

const CELL = 48

function actorLabel(id: string, status?: string): string {
  return `${id}${status === 'captured' ? ', captured' : ''}`
}

export function GameBoard({
  state,
  onTarget,
}: {
  state: SimulationState
  onTarget(target: Coordinate): void
}) {
  const map = getMap(state.mapId)
  const activePointer = useRef<number | null>(null)
  const pendingTarget = useRef<Coordinate | null>(null)
  const cells = Array.from({ length: map.width * map.height }, (_, index) => ({
    x: index % map.width,
    y: Math.floor(index / map.width),
  }))
  return (
    <svg
      className="game-board"
      role="application"
      aria-label="Dual Shadow Chase board"
      viewBox={`0 0 ${map.width * CELL} ${map.height * CELL}`}
      onPointerUp={(event) => {
        if (activePointer.current !== event.pointerId || !pendingTarget.current) return
        if (
          pendingTarget.current.x !== state.actors.player.position.x ||
          pendingTarget.current.y !== state.actors.player.position.y
        ) {
          onTarget(pendingTarget.current)
        }
        activePointer.current = null
        pendingTarget.current = null
      }}
      onPointerCancel={() => {
        activePointer.current = null
        pendingTarget.current = null
      }}
    >
      <title>{map.name}</title>
      {cells.map((cell) => {
        const wall = map.walls.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)
        return (
          <rect
            key={`${cell.x}-${cell.y}`}
            className={wall ? 'board-cell wall' : 'board-cell'}
            x={cell.x * CELL + 1}
            y={cell.y * CELL + 1}
            width={CELL - 2}
            height={CELL - 2}
            rx="8"
            aria-hidden="true"
            onPointerDown={(event) => {
              if (wall || activePointer.current !== null) return
              activePointer.current = event.pointerId
              pendingTarget.current = cell
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
          />
        )
      })}
      <g
        className={state.exit.enabled ? 'exit enabled' : 'exit'}
        transform={`translate(${state.exit.position.x * CELL + CELL / 2} ${state.exit.position.y * CELL + CELL / 2})`}
        aria-label={state.exit.enabled ? 'Moon gate, open' : 'Moon gate, sealed'}
      >
        <circle r="17" />
        <path d="M-8 8V-4L0-12 8-4V8" />
      </g>
      {state.objectives.map((objective) =>
        objective.collected ? null : (
          <g
            key={objective.id}
            className="core"
            transform={`translate(${objective.position.x * CELL + CELL / 2} ${objective.position.y * CELL + CELL / 2})`}
            aria-label={`Light core ${objective.id}`}
          >
            <path d="M0-13 9-5 6 8 0 13-6 8-9-5Z" />
          </g>
        )
      )}
      {(['player', 'companion'] as const).map((id) => {
        const actor = state.actors[id]
        return (
          <g
            key={id}
            className={`shadow ${id} ${actor.status}`}
            transform={`translate(${actor.position.x * CELL + CELL / 2} ${actor.position.y * CELL + CELL / 2})`}
            aria-label={actorLabel(id, actor.status)}
          >
            <circle r="15" />
            <path d={id === 'player' ? 'M-6 2 0-8 6 2 0 9Z' : 'M-8-2 0-9 8-2 5 8-5 8Z'} />
          </g>
        )
      })}
      <g
        className={state.tick < OPENING_GRACE_TICKS ? 'pursuer dormant' : 'pursuer'}
        transform={`translate(${state.actors.pursuer.position.x * CELL + CELL / 2} ${state.actors.pursuer.position.y * CELL + CELL / 2})`}
        aria-label={
          state.tick < OPENING_GRACE_TICKS ? 'Pursuer, waiting during head start' : 'Pursuer'
        }
      >
        <circle r="16" />
        <path d="M-8-8 8 8M8-8-8 8" />
      </g>
    </svg>
  )
}
