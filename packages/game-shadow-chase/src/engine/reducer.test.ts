import { describe, expect, it } from 'vitest'

import { MIN_RUN_TICKS, OPENING_GRACE_TICKS, RUN_CAP_TICKS } from './config'
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
      action(state, 2, { type: 'companion-command', command: 'follow' }),
    ])
    expect(next.actors.player.position).toEqual({ x: 2, y: 1 })
    expect(next.actors.companion.position).toEqual({ x: 3, y: 1 })
  })

  it('applies swap atomically and starts cooldown', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    const playerStart = state.actors.player.position
    const companionStart = state.actors.companion.position
    const next = advance(state, [action(state, 1, { type: 'swap' })])
    expect(next.actors.player.position).toEqual(companionStart)
    expect(next.actors.companion.position).toEqual(playerStart)
    expect(next.cooldowns.swapReadyTick).toBeGreaterThan(next.tick)
  })

  it('increments the decision epoch when a command retargets the pursuer', () => {
    const state = createRunningState('courtyard', 'standard', 7)
    state.tick = OPENING_GRACE_TICKS + 1
    const next = advance(state, [action(state, 1, { type: 'companion-command', command: 'decoy' })])
    expect(next.actors.pursuer.target).toBe('companion')
    expect(next.decisionEpoch).toBe(2)
  })

  it('holds the pursuer and prevents capture throughout the five-second opening grace', () => {
    let state = createRunningState('courtyard', 'standard', 7)
    const pursuerSpawn = { ...state.actors.pursuer.position }
    while (state.tick < OPENING_GRACE_TICKS) state = advance(state, [])
    expect(state.phase).toBe('running')
    expect(state.actors.player.status).toBe('free')
    expect(state.actors.companion.status).toBe('free')
    expect(state.actors.pursuer.position).toEqual(pursuerSpawn)
  })

  it('enables contact resolution on the first tick after opening grace', () => {
    const duringGrace = createRunningState('courtyard', 'intense', 7)
    duringGrace.tick = OPENING_GRACE_TICKS - 1
    duringGrace.actors.pursuer.position = { x: 1, y: 2 }
    const safe = advance(duringGrace, [])
    expect(safe.actors.player.status).toBe('free')
    expect(safe.actors.pursuer.position).toEqual({ x: 1, y: 2 })

    const contacted = advance(safe, [])
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
})
