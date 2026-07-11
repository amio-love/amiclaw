/**
 * Lose condition + death (§3): the full neglect ladder to `dead`, isLost(),
 * the win/lose same-tick precedence (lose wins ties), the game-agnostic
 * "dead is terminal — no resurrection" guard, and the enum-order invariance of
 * prepending `dead`. Exercised on the v1.1.0 botanical fixtures.
 *
 * Covers test-design cases TC-25, TC-26, TC-28, TC-29, TC-31, and the engine
 * half of TC-17 (the lie a lying decay ring would tell).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import type { GameType, Level, TimedEmitter } from '../schema/types'
import { GameSession } from './engine'

const bgDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'botanical-garden'
)
const gameType = loadGameType(readFileSync(join(bgDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(bgDir, 'level.bg-demo-001.yaml'), 'utf8'))

const INTERVAL = 1000

function fastDecayEmitter(overrides: Partial<TimedEmitter> = {}): TimedEmitter {
  return {
    id: 'decay',
    event: 'neglect',
    target_template: 'health_response',
    target: { kind: 'archetype', archetype: 'plant' },
    interval_ms: INTERVAL,
    ...overrides,
  }
}

/** v1.1.0 clone: fast decay emitter, plant health seeded, stagger cleared. */
function fixture(seedHealth: Record<string, string> = {}): { gt: GameType; level: Level } {
  const gt = structuredClone(gameType)
  gt.timed_emitters = [fastDecayEmitter()]
  const lvl = structuredClone(level)
  for (const plant of lvl.elements) {
    if (plant.archetype !== 'plant') continue
    delete plant.initial_timers
    const health = seedHealth[plant.id]
    if (health) plant.initial_states = { ...plant.initial_states, health }
  }
  return { gt, level: lvl }
}

describe('death via the full neglect ladder', () => {
  it('TC-25: neglect walks thriving → dead and isLost() flips at dead', () => {
    // All three plants seeded thriving with equal timing → they die in
    // lockstep on the fourth tick, so no earlier death freezes the run before
    // plant-1 completes its ladder.
    const { gt, level: lvl } = fixture({
      'plant-1': 'thriving',
      'plant-2': 'thriving',
      'plant-3': 'thriving',
    })
    const session = new GameSession(gt, lvl)
    const seen: string[] = []
    const lostAfter: boolean[] = []
    let lastTicks: ReturnType<GameSession['advanceTime']> = []
    for (let i = 0; i < 4; i++) {
      lastTicks = session.advanceTime(INTERVAL)
      seen.push(String(session.getState().elements['plant-1'].health))
      lostAfter.push(session.isLost())
    }
    expect(seen).toEqual(['stable', 'wilting', 'critical', 'dead'])
    expect(lostAfter).toEqual([false, false, false, true])
    const p1Tick = lastTicks.find((t) => t.elementId === 'plant-1')
    expect(p1Tick?.event).toBe('neglect')
    expect(p1Tick?.fired).toBe(true)
  })

  it('TC-17 (engine): an emitter-targeted plant with no consuming rule never dies (the ring lies)', () => {
    // Drop plant-3 from rule-health but keep it decay-targeted (archetype:plant)
    // — its timer ticks yet the event is inert, so it can never reach dead.
    const gt = structuredClone(gameType)
    gt.timed_emitters = [fastDecayEmitter()]
    const lvl = structuredClone(level)
    for (const plant of lvl.elements) {
      if (plant.archetype === 'plant') delete plant.initial_timers
    }
    const ruleHealth = lvl.rules.find((r) => r.id === 'rule-health')
    if (!ruleHealth) throw new Error('fixture rule-health missing')
    ruleHealth.target_elements = ruleHealth.target_elements.filter((id) => id !== 'plant-3')

    const session = new GameSession(gt, lvl)
    const ticks = session.advanceTime(INTERVAL)
    const p3Tick = ticks.find((t) => t.elementId === 'plant-3')
    expect(p3Tick).toBeTruthy() // the ring renders (plant-3 is targeted)
    expect(p3Tick?.fired).toBe(false) // …but the event is inert
    expect(session.getState().elements['plant-3'].health).toBe('wilting') // never decays
  })
})

describe('win/lose precedence + terminal death', () => {
  it('TC-26: win AND lose true in the same tick resolves to a LOSS (lose wins ties)', () => {
    // Win = a flowering plant only (no health floor); Lose = any dead plant.
    const gt = structuredClone(gameType)
    const lvl = structuredClone(level)
    lvl.win_condition = {
      type: 'optimization_target',
      params: { count_states_equal: [{ state: 'growth_stage', value: 'flowering', count: 1 }] },
    }
    const p1 = lvl.elements.find((e) => e.id === 'plant-1')
    const p2 = lvl.elements.find((e) => e.id === 'plant-2')
    if (!p1 || !p2) throw new Error('fixture plants missing')
    p1.initial_states = { ...p1.initial_states, growth_stage: 'flowering' }
    p2.initial_states = { ...p2.initial_states, health: 'dead' }

    const session = new GameSession(gt, lvl)
    // Raw predicates: both true.
    expect(session.isWon()).toBe(true)
    expect(session.isLost()).toBe(true)
    // Resolved snapshot: lose wins the tie — never a win with a corpse.
    expect(session.getState().won).toBe(false)
    expect(session.getState().lost).toBe(true)
  })

  it('TC-28: care can never resurrect a dead plant (dead is terminal, game-agnostic)', () => {
    // A dead orchid at partial_shade would satisfy rule-orchid-care's heal
    // (advance_state) — the guard must block that revival.
    const { gt, level: lvl } = fixture({ 'plant-3': 'dead' })
    const p3 = lvl.elements.find((e) => e.id === 'plant-3')
    if (!p3) throw new Error('plant-3 missing')
    p3.initial_states = { ...p3.initial_states, health: 'dead', effective_light: 'partial_shade' }

    const session = new GameSession(gt, lvl)
    expect(session.isLost()).toBe(true)
    const result = session.performAction('gardener', 'apply_care', {
      element_id: 'plant-3',
      action_type: 'water',
    })
    expect(result.ok).toBe(true) // the action is accepted…
    expect(session.getState().elements['plant-3'].health).toBe('dead') // …but inert on the corpse
  })

  it('F3: a dead-exit transition row cannot resurrect via performAction (engine guard)', () => {
    // Even if a level authored a `[dead, correct_care, wilting]` row, the
    // state_transition guard blocks it (performAction is not frozen by isLost).
    const { gt, level: lvl } = fixture({ 'plant-1': 'dead' })
    const ruleHealth = lvl.rules.find((r) => r.id === 'rule-health')
    if (!ruleHealth) throw new Error('fixture rule-health missing')
    const rows = ruleHealth.bindings.transitions as unknown[]
    ruleHealth.bindings = {
      ...ruleHealth.bindings,
      transitions: [...rows, ['dead', 'correct_care', 'wilting']],
    }

    const session = new GameSession(gt, lvl)
    expect(session.isLost()).toBe(true)
    const result = session.performAction('gardener', 'apply_care', {
      element_id: 'plant-1',
      action_type: 'water', // → correct_care, which the dead-exit row would consume
    })
    expect(result.ok).toBe(true)
    expect(session.getState().elements['plant-1'].health).toBe('dead') // guard blocks revival
  })

  it('TC-31: an all-dead board is lost, timerStatus stays sane, advanceTime is frozen', () => {
    const { gt, level: lvl } = fixture({ 'plant-1': 'dead', 'plant-2': 'dead', 'plant-3': 'dead' })
    const session = new GameSession(gt, lvl)
    expect(session.isLost()).toBe(true)
    const status = session.timerStatus()
    expect(status.length).toBe(3) // one per plant
    expect(status.every((t) => t.msUntilTick >= 0)).toBe(true)
    expect(session.advanceTime(INTERVAL)).toEqual([]) // frozen after game over
  })
})

describe('TC-29: prepending dead preserves optimization_target rank semantics', () => {
  it('all >= stable + one flowering still wins; a wilting plant still fails the floor', () => {
    const won = structuredClone(level)
    for (const plant of won.elements) {
      if (plant.archetype === 'plant') {
        plant.initial_states = { ...plant.initial_states, health: 'stable' }
      }
    }
    const p3won = won.elements.find((e) => e.id === 'plant-3')
    if (!p3won) throw new Error('plant-3 missing')
    p3won.initial_states = { ...p3won.initial_states, growth_stage: 'flowering' }
    expect(new GameSession(gameType, won).isWon()).toBe(true)

    // One plant left at wilting ranks BELOW stable in the shifted order → no win.
    const notWon = structuredClone(won)
    const p1 = notWon.elements.find((e) => e.id === 'plant-1')
    if (!p1) throw new Error('plant-1 missing')
    p1.initial_states = { ...p1.initial_states, health: 'wilting' }
    expect(new GameSession(gameType, notWon).isWon()).toBe(false)
  })
})
