import { describe, expect, it } from 'vitest'

import { MIN_RUN_TICKS, RUN_CAP_TICKS } from './config'
import { pursuerNextStep } from './pursuer-policy'
import { createRunningState } from './rules'
import { advance } from './reducer'
import type { QueuedAction, SimulationState } from './types'

function action(
  state: SimulationState,
  sequence: number,
  value: QueuedAction['action']
): QueuedAction {
  return { applyAtTick: state.tick + 1, sequence, action: value }
}

describe('ten-phase reducer contract', () => {
  it('keeps two free shadows still when they cross the same edge', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.actors.player.position = { x: 2, y: 1 }
    state.actors.companion.position = { x: 3, y: 1 }
    const next = advance(state, [
      action(state, 1, { type: 'player-move', direction: 'right' }),
      action(state, 2, { type: 'companion-command', command: 'support' }),
    ])
    expect(next.actors.player.position).toEqual({ x: 2, y: 1 })
    expect(next.actors.companion.position).toEqual({ x: 3, y: 1 })
  })

  it('applies a charged swap atomically and consumes the charge', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.swapCharges = 1
    const playerStart = state.actors.player.position
    const companionStart = state.actors.companion.position
    const next = advance(state, [action(state, 1, { type: 'swap' })])
    expect(next.actors.player.position).toEqual(companionStart)
    expect(next.actors.companion.position).toEqual(playerStart)
    expect(next.swapCharges).toBe(0)
  })

  it('accepts an anchor command without granting the pursuer command knowledge', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.tick = 1
    const next = advance(state, [
      action(state, 1, { type: 'companion-command', command: 'anchor' }),
    ])
    expect(next.command.intent).toBe('anchor')
    expect(next.actors.pursuer.target).toBe('player')
    expect(next.actors.pursuer.destination).toBe('moon-gate')
    expect(next.decisionEpoch).toBe(1)
  })

  it('resolves contact before the pursuer leaves an occupied tile', () => {
    const state = createRunningState('courtyard', 'relaxed', 7)
    state.actors.player.position = { ...state.actors.pursuer.position }

    const contacted = advance(state, [])

    expect(contacted.actors.pursuer.position).toEqual(state.actors.pursuer.position)
    expect(contacted.actors.player.status).toBe('captured')
    expect(contacted.actors.pursuer.destination).toBe('moon-gate')
    expect(contacted.actors.pursuer.target).toBe('player')
  })

  it('reconciles destination after same-cell capture while retaining actor tie memory', () => {
    const state = createRunningState('courtyard', 'intense', 7)
    state.actors.pursuer.position = { x: 2, y: 1 }
    state.actors.player.position = { x: 1, y: 1 }
    state.actors.companion.position = { x: 6, y: 6 }

    const contacted = advance(state, [])

    expect(contacted.actors.pursuer.position).toEqual({ x: 1, y: 1 })
    expect(contacted.actors.player.status).toBe('captured')
    expect(contacted.actors.pursuer.destination).toBe('moon-gate')
    expect(contacted.actors.pursuer.target).toBe('player')
  })

  it('captures opposite-edge crossing', () => {
    const state = createRunningState('courtyard', 'intense', 7)
    state.actors.player.position = { x: 1, y: 1 }
    state.actors.companion.position = { x: 6, y: 6 }
    state.actors.pursuer.position = { x: 2, y: 1 }
    state.actors.pursuer.destination = 'player'

    const crossed = advance(
      state,
      [action(state, 1, { type: 'player-move', direction: 'right' })],
      {
        companion: (current) => current.actors.companion.position,
        pursuer: () => ({ x: 1, y: 1 }),
      }
    )

    expect(crossed.actors.player.status).toBe('captured')
    expect(crossed.actors.pursuer.destination).toBe('moon-gate')
    expect(crossed.actors.pursuer.target).toBe('player')
  })

  it('captures contact while returning to the moon gate', () => {
    const state = createRunningState('courtyard', 'intense', 7)
    state.actors.pursuer.position = { x: 1, y: 6 }
    state.actors.player.position = { x: 0, y: 5 }
    state.actors.companion.position = { x: 6, y: 0 }

    const contacted = advance(
      state,
      [action(state, 1, { type: 'player-move', direction: 'down' })],
      {
        companion: (current) => current.actors.companion.position,
        pursuer: pursuerNextStep,
      }
    )

    expect(contacted.actors.pursuer.destination).toBe('moon-gate')
    expect(contacted.actors.pursuer.position).toEqual(state.exit.position)
    expect(contacted.actors.player.status).toBe('captured')
  })

  it('moves the pursuer and resolves contact on the first chase tick', () => {
    const state = createRunningState('courtyard', 'intense', 7)
    state.actors.pursuer.position = { x: 1, y: 2 }

    const contacted = advance(state, [])

    expect(contacted.tick).toBe(1)
    expect(contacted.actors.pursuer.position).toEqual({ x: 1, y: 1 })
    expect(contacted.actors.player.status).toBe('captured')
  })

  it('allows exact-deadline rescue before deadline loss', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.tick = 19
    state.actors.player.status = 'captured'
    state.actors.player.rescueDeadlineTick = 20
    state.actors.companion.position = { ...state.actors.player.position }
    state.actors.pursuer.position = { x: 6, y: 6 }
    const next = advance(state, [])
    expect(next.actors.player.status).toBe('free')
    expect(next.phase).toBe('running')
  })

  it('makes loss beat win and exact-cap win beat timeout', () => {
    const loss = createRunningState('courtyard', 'standard', 7)
    loss.actors.player.status = 'captured'
    loss.actors.companion.status = 'captured'
    loss.objectives.forEach((objective) => {
      objective.collected = true
    })
    loss.exit.enabled = true
    loss.actors.player.position = { ...loss.exit.position }
    loss.actors.companion.position = { ...loss.exit.position }
    expect(advance(loss, []).phase).toBe('loss')

    const win = createRunningState('courtyard', 'standard', 7)
    win.tick = RUN_CAP_TICKS - 1
    win.objectives.forEach((objective) => {
      objective.collected = true
    })
    win.exit.enabled = true
    win.actors.player.position = { ...win.exit.position }
    win.actors.companion.position = { ...win.exit.position }
    win.actors.pursuer.position = { x: 6, y: 6 }
    expect(advance(win, []).phase).toBe('win')
  })

  it('keeps the moon gate sealed until two minutes even for a 71-tick shortest trace', () => {
    let state = createRunningState('courtyard', 'relaxed', 7)
    state.tick = 70
    state.objectives.forEach((objective) => {
      objective.collected = true
    })
    state.actors.player.position = { ...state.exit.position }
    state.actors.companion.position = { ...state.exit.position }
    state.actors.pursuer.position = { x: 6, y: 6 }
    const stationaryPolicies = {
      companion: (current: SimulationState) => current.actors.companion.position,
      pursuer: (current: SimulationState) => current.actors.pursuer.position,
    }

    state = advance(state, [], stationaryPolicies)
    expect(state.tick).toBe(71)
    expect(state.exit.enabled).toBe(false)
    expect(state.phase).toBe('running')

    while (state.phase === 'running' && state.tick < MIN_RUN_TICKS) {
      state = advance(state, [], stationaryPolicies)
    }
    expect(state.tick).toBe(MIN_RUN_TICKS)
    expect(state.exit.enabled).toBe(true)
    expect(state.phase).toBe('win')
  })

  it('is absorbing after a terminal outcome', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.phase = 'loss'
    state.terminal = { outcome: 'loss', reason: 'both-captured', tick: state.tick }
    expect(advance(state, [action(state, 1, { type: 'swap' })])).toBe(state)
  })

  it('proves deterministic companion rescue changes the outcome of the same player trace', () => {
    const fixture = createRunningState('courtyard', 'standard', 7)
    fixture.tick = 19
    fixture.actors.player.status = 'captured'
    fixture.actors.player.rescueDeadlineTick = 20
    fixture.actors.player.position = { x: 1, y: 1 }
    fixture.actors.companion.position = { x: 2, y: 1 }
    fixture.actors.pursuer.position = { x: 6, y: 6 }

    const rescued = advance(structuredClone(fixture), [])
    const noOpCompanion = advance(structuredClone(fixture), [], {
      companion: (state) => state.actors.companion.position,
      pursuer: (state) => state.actors.pursuer.position,
    })

    expect(rescued.phase).toBe('running')
    expect(rescued.actors.player.status).toBe('free')
    expect(noOpCompanion.phase).toBe('loss')
  })

  it('persists a tap target and reports closed movement rejection reasons', () => {
    const state = createRunningState('crossroads', 'standard', 7)
    const targeted = advance(state, [
      action(state, 11, { type: 'player-target', target: { x: 3, y: 1 } }),
    ])
    expect(targeted.actors.player.position).toEqual({ x: 2, y: 1 })
    expect(targeted.playerNavigation).toEqual({ target: { x: 3, y: 1 }, actionSequence: 11 })
    const arrived = advance(targeted, [])
    expect(arrived.actors.player.position).toEqual({ x: 3, y: 1 })
    expect(arrived.playerNavigation).toBeUndefined()

    const edge = createRunningState('courtyard', 'standard', 7)
    edge.actors.player.position = { x: 0, y: 0 }
    const rejected = advance(edge, [action(edge, 12, { type: 'player-move', direction: 'up' })])
    expect(rejected.eventLog.at(-1)).toMatchObject({
      type: 'move-rejected',
      actionSequence: 12,
      reason: 'edge',
    })
  })

  it('keeps a path after a temporary companion block and rejects wall targets', () => {
    const blocked = createRunningState('courtyard', 'standard', 7)
    blocked.actors.player.position = { x: 1, y: 1 }
    blocked.actors.companion.position = { x: 2, y: 1 }
    const stationaryPolicies = {
      companion: (current: SimulationState) => current.actors.companion.position,
      pursuer: (current: SimulationState) => current.actors.pursuer.position,
    }
    const kept = advance(
      blocked,
      [action(blocked, 20, { type: 'player-target', target: { x: 3, y: 1 } })],
      stationaryPolicies
    )
    expect(kept.actors.player.position).toEqual({ x: 1, y: 1 })
    expect(kept.playerNavigation?.target).toEqual({ x: 3, y: 1 })
    expect(kept.eventLog.at(-1)).toMatchObject({
      type: 'move-rejected',
      reason: 'companion',
      actionSequence: 20,
    })

    const wall = createRunningState('courtyard', 'standard', 7)
    const rejected = advance(wall, [
      action(wall, 21, { type: 'player-target', target: { x: 3, y: 2 } }),
    ])
    expect(rejected.playerNavigation).toBeUndefined()
    expect(rejected.eventLog.at(-1)).toMatchObject({
      type: 'move-rejected',
      reason: 'wall',
      actionSequence: 21,
    })
  })
})
