import { useRef } from 'react'

import { getMap } from '../engine/maps'
import { sightLanes } from '../engine/line-of-sight'
import {
  buildPursuerObservation,
  selectPursuerDecision,
  type PursuerDestination,
} from '../engine/pursuer-policy'
import type { Coordinate, SimulationState } from '../engine/types'

const CELL = 48

function actorLabel(id: 'player' | 'companion', status: string): string {
  const name = id === 'player' ? '你' : 'AI 伙伴'
  return `${name}${status === 'captured' ? '，已被捕获' : '，行动自由'}`
}

function sameCoordinate(left: Coordinate, right: Coordinate): boolean {
  return left.x === right.x && left.y === right.y
}

function coordinateFromPointer(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  width: number,
  height: number
): Coordinate | null {
  let x: number
  let y: number
  const matrix = svg.getScreenCTM?.()
  if (matrix && typeof DOMPoint !== 'undefined') {
    const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    x = local.x
    y = local.y
  } else {
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    x = ((clientX - rect.left) / rect.width) * width * CELL
    y = ((clientY - rect.top) / rect.height) * height * CELL
  }
  const target = { x: Math.floor(x / CELL), y: Math.floor(y / CELL) }
  return target.x >= 0 && target.y >= 0 && target.x < width && target.y < height ? target : null
}

export function GameBoard({
  state,
  interactive = true,
  onTarget,
}: {
  state: SimulationState
  interactive?: boolean
  onTarget(target: Coordinate): void
}) {
  const map = getMap(state.mapId)
  const pursuer = state.actors.pursuer
  const lanes = sightLanes(map, pursuer.position)
  const displayedDestination: PursuerDestination =
    !interactive || state.tick === 0
      ? selectPursuerDecision(buildPursuerObservation(state)).destination
      : pursuer.destination
  const destinationPosition =
    displayedDestination === 'moon-gate'
      ? state.exit.position
      : state.actors[displayedDestination].position
  const destinationName = displayedDestination === 'moon-gate' ? '月门' : '你'
  const destinationDescriptionId = `pursuer-destination-${state.runId}`
  const arrowheadId = `pursuer-arrowhead-${state.runId}`
  const gesture = useRef<{ pointerId: number; start: Coordinate } | null>(null)
  const cells = Array.from({ length: map.width * map.height }, (_, index) => ({
    x: index % map.width,
    y: Math.floor(index / map.width),
  }))

  const clearGesture = () => {
    gesture.current = null
  }

  return (
    <svg
      className={interactive ? 'game-board interactive' : 'game-board planning-board'}
      role="application"
      aria-label="双影追逃地图"
      aria-describedby={destinationDescriptionId}
      aria-disabled={!interactive}
      viewBox={`0 0 ${map.width * CELL} ${map.height * CELL}`}
      onPointerDown={(event) => {
        if (!interactive || gesture.current) return
        const target = coordinateFromPointer(
          event.currentTarget,
          event.clientX,
          event.clientY,
          map.width,
          map.height
        )
        if (!target) return
        gesture.current = { pointerId: event.pointerId, start: target }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerUp={(event) => {
        const active = gesture.current
        if (!interactive || !active || active.pointerId !== event.pointerId) return
        const target = coordinateFromPointer(
          event.currentTarget,
          event.clientX,
          event.clientY,
          map.width,
          map.height
        )
        clearGesture()
        if (
          target &&
          sameCoordinate(target, active.start) &&
          !sameCoordinate(target, state.actors.player.position)
        ) {
          onTarget(target)
        }
      }}
      onPointerCancel={clearGesture}
      onLostPointerCapture={clearGesture}
    >
      <title>{map.name}</title>
      <desc id={destinationDescriptionId}>追兵当前目标：{destinationName}</desc>
      <defs>
        <marker
          className="pursuer-arrowhead"
          id={arrowheadId}
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
          markerUnits="userSpaceOnUse"
          aria-hidden="true"
        >
          <path d="M0 0 6 3 0 6Z" />
        </marker>
      </defs>
      {cells.map((cell) => {
        const wall = map.walls.some((candidate) => sameCoordinate(candidate, cell))
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
          />
        )
      })}
      {lanes.map((lane) => (
        <line
          key={lane.id}
          className="sight-lane board-overlay"
          data-direction={lane.id}
          x1={pursuer.position.x * CELL + CELL / 2}
          y1={pursuer.position.y * CELL + CELL / 2}
          x2={lane.end.x * CELL + CELL / 2}
          y2={lane.end.y * CELL + CELL / 2}
          aria-hidden="true"
        />
      ))}
      <g className="pursuer-destination-indicator board-overlay" aria-hidden="true">
        <line
          x1={pursuer.position.x * CELL + CELL / 2}
          y1={pursuer.position.y * CELL + CELL / 2}
          x2={destinationPosition.x * CELL + CELL / 2}
          y2={destinationPosition.y * CELL + CELL / 2}
          markerEnd={`url(#${arrowheadId})`}
        />
        <circle
          cx={destinationPosition.x * CELL + CELL / 2}
          cy={destinationPosition.y * CELL + CELL / 2}
          r="20"
        />
      </g>
      {state.playerNavigation && (
        <rect
          className="path-target board-overlay"
          x={state.playerNavigation.target.x * CELL + 5}
          y={state.playerNavigation.target.y * CELL + 5}
          width={CELL - 10}
          height={CELL - 10}
          rx="10"
          aria-hidden="true"
        />
      )}
      <g
        className={state.exit.enabled ? 'exit enabled board-overlay' : 'exit board-overlay'}
        transform={`translate(${state.exit.position.x * CELL + CELL / 2} ${state.exit.position.y * CELL + CELL / 2})`}
        aria-label={state.exit.enabled ? '月门，已开启' : '月门，尚未开启'}
      >
        <circle r="17" />
        <path d="M-8 8V-4L0-12 8-4V8" />
      </g>
      {state.objectives.map((objective, index) =>
        objective.collected ? null : (
          <g
            key={objective.id}
            className="core board-overlay"
            transform={`translate(${objective.position.x * CELL + CELL / 2} ${objective.position.y * CELL + CELL / 2})`}
            aria-label={`光核 ${index + 1}`}
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
            className={`shadow ${id} ${actor.status} board-overlay`}
            transform={`translate(${actor.position.x * CELL + CELL / 2} ${actor.position.y * CELL + CELL / 2})`}
            aria-label={actorLabel(id, actor.status)}
          >
            <circle r="15" />
            <path d={id === 'player' ? 'M-6 2 0-8 6 2 0 9Z' : 'M-8-2 0-9 8-2 5 8-5 8Z'} />
          </g>
        )
      })}
      <g
        className="pursuer board-overlay"
        transform={`translate(${state.actors.pursuer.position.x * CELL + CELL / 2} ${state.actors.pursuer.position.y * CELL + CELL / 2})`}
        aria-label="追兵"
      >
        <circle r="16" />
        <path d="M-8-8 8 8M8-8-8 8" />
      </g>
    </svg>
  )
}
