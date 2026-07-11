/**
 * Timed decay engine extension (§2): the host-injected advanceTime clock +
 * per-(emitter, element) timerStatus, exercised on the botanical vocabulary
 * through the SHARED state_transition core. All timers are synthetic clones of
 * the golden (R1 keeps the shipped fixtures free of timed_emitters); the
 * engine reads no wall-clock, so every assertion is deterministic.
 *
 * Covers test-design cases TC-01..TC-04, TC-18/TC-19 (manager-pinned throw),
 * TC-20, TC-22, TC-24, TC-27, TC-30, TC-32.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import type { GameType, Level, TimedEmitter } from '../schema/types'
import { GameSession } from './engine'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')
const bgDir = join(fixturesDir, 'botanical-garden')
const gameType = loadGameType(readFileSync(join(bgDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(bgDir, 'level.bg-demo-001.yaml'), 'utf8'))
const rcDir = join(fixturesDir, 'radio-cipher')
const rcGameType = loadGameType(readFileSync(join(rcDir, 'game-type.yaml'), 'utf8'))
const rcLevel = loadLevel(readFileSync(join(rcDir, 'level.rc-demo-001.yaml'), 'utf8'))

const INTERVAL = 1000

function decayEmitter(overrides: Partial<TimedEmitter> = {}): TimedEmitter {
  return {
    id: 'decay',
    event: 'neglect',
    target_template: 'health_response',
    target: { kind: 'all' },
    interval_ms: INTERVAL,
    warning_lead_ms: 200,
    ...overrides,
  }
}

/**
 * Clone the golden with a single decay emitter, all three plants seeded
 * thriving, and the fixture's initial_timers stagger CLEARED so each test
 * controls timing against the emitter's interval (the shipped 60s offsets
 * would otherwise overshoot a 1s test interval and fire on the first tick).
 */
function decayFixture(emitter: TimedEmitter = decayEmitter()): { gt: GameType; level: Level } {
  const gt = structuredClone(gameType)
  gt.timed_emitters = [emitter]
  const lvl = structuredClone(level)
  for (const id of ['plant-1', 'plant-2', 'plant-3']) {
    const plant = lvl.elements.find((e) => e.id === id)
    if (!plant) throw new Error(`fixture element ${id} missing`)
    plant.initial_states = { ...plant.initial_states, health: 'thriving' }
    delete plant.initial_timers
  }
  return { gt, level: lvl }
}

describe('advanceTime — no-op / boundary cases', () => {
  it('TC-01: absent timed_emitters is a total no-op (radio-cipher)', () => {
    const session = new GameSession(rcGameType, rcLevel)
    const before = JSON.stringify(session.getState())
    expect(session.advanceTime(10_000)).toEqual([])
    expect(session.timerStatus()).toEqual([])
    expect(JSON.stringify(session.getState())).toBe(before)
  })

  it('TC-02: empty timed_emitters:[] behaves identically to absent', () => {
    const gt = structuredClone(gameType)
    gt.timed_emitters = []
    const session = new GameSession(gt, level)
    expect(session.advanceTime(5000)).toEqual([])
    expect(session.timerStatus()).toEqual([])
  })

  it('TC-04: an emitter targeting elements with no consuming rule fires nothing harmful', () => {
    // Archetype-scoped onto environment_zone: real elements, but no
    // health_response rule + empty state machine → every tick is inert.
    const gt = structuredClone(gameType)
    gt.timed_emitters = [
      decayEmitter({ target: { kind: 'archetype', archetype: 'environment_zone' } }),
    ]
    const session = new GameSession(gt, level)
    const before = JSON.stringify(session.getState())
    let ticks: ReturnType<GameSession['advanceTime']> = []
    expect(() => {
      ticks = session.advanceTime(2 * INTERVAL)
    }).not.toThrow()
    expect(ticks.length).toBe(3) // zone-north/center/south
    expect(ticks.every((t) => t.fired === false)).toBe(true)
    expect(JSON.stringify(session.getState())).toBe(before)
  })
})

describe('advanceTime — firing through the state_transition core', () => {
  it('TC-03: the minimum positive interval (1ms) fires on the smallest tick', () => {
    const { gt, level: lvl } = decayFixture(decayEmitter({ interval_ms: 1 }))
    const session = new GameSession(gt, lvl)
    const ticks = session.advanceTime(1)
    const fired = ticks.filter((t) => t.fired)
    expect(fired.length).toBe(3) // all three plants thriving → stable
    expect(session.getState().elements['plant-1'].health).toBe('stable')
    expect(ticks.every((t) => t.event === 'neglect')).toBe(true)
  })

  it('TC-24: a heal action counteracts a decay step through the same shared core', () => {
    const { gt, level: lvl } = decayFixture()
    const session = new GameSession(gt, lvl)
    session.advanceTime(INTERVAL) // neglect: thriving → stable
    expect(session.getState().elements['plant-1'].health).toBe('stable')
    session.performAction('gardener', 'apply_care', { element_id: 'plant-1', action_type: 'water' })
    expect(session.getState().elements['plant-1'].health).toBe('thriving') // correct_care heal
    session.advanceTime(INTERVAL) // neglect again: thriving → stable
    expect(session.getState().elements['plant-1'].health).toBe('stable')
  })

  it('TC-27: a big dt fires once (tick cap) — NOT associative with repeated small dt', () => {
    const fa = decayFixture()
    const a = new GameSession(fa.gt, fa.level)
    a.advanceTime(3 * INTERVAL) // capped: one fire, thriving → stable
    expect(a.getState().elements['plant-1'].health).toBe('stable')

    const fb = decayFixture()
    const b = new GameSession(fb.gt, fb.level)
    b.advanceTime(INTERVAL) // thriving → stable
    b.advanceTime(INTERVAL) // stable → wilting
    b.advanceTime(INTERVAL) // wilting → critical (full v1.1.0 ladder), not yet dead
    expect(b.getState().elements['plant-1'].health).toBe('critical')

    expect(a.getState().elements['plant-1'].health).not.toBe(
      b.getState().elements['plant-1'].health
    )
  })
})

describe('advanceTime — idempotency + adversarial dt (manager-pinned)', () => {
  it('TC-22: advanceTime(0) is idempotent; sub-interval charge accumulates then fires once', () => {
    const { gt, level: lvl } = decayFixture()
    const session = new GameSession(gt, lvl)
    const before = JSON.stringify(session.getState())
    expect(session.advanceTime(0)).toEqual([])
    expect(JSON.stringify(session.getState())).toBe(before)

    expect(session.advanceTime(INTERVAL / 2).some((t) => t.fired)).toBe(false) // no cross yet
    const second = session.advanceTime(INTERVAL / 2)
    expect(second.filter((t) => t.fired).length).toBe(3) // crosses on the cumulative total
    expect(session.getState().elements['plant-1'].health).toBe('stable')
  })

  it('TC-18/TC-19: non-finite or negative dt THROWS (host bug, fail loud); later valid call still fires', () => {
    const { gt, level: lvl } = decayFixture()
    const session = new GameSession(gt, lvl)
    expect(() => session.advanceTime(-500)).toThrow()
    expect(() => session.advanceTime(Number.NaN)).toThrow()
    expect(() => session.advanceTime(Number.POSITIVE_INFINITY)).toThrow()
    // The rejected calls mutate nothing, so charge is intact.
    expect(session.advanceTime(INTERVAL).some((t) => t.fired)).toBe(true)
  })
})

describe('advanceTime — game-over freeze + timerStatus', () => {
  /** All plants thriving + plant-3 flowering → optimization_target already met. */
  function wonFixture(): { gt: GameType; level: Level } {
    const gt = structuredClone(gameType)
    gt.timed_emitters = [decayEmitter()]
    const lvl = structuredClone(level)
    for (const id of ['plant-1', 'plant-2', 'plant-3']) {
      const plant = lvl.elements.find((e) => e.id === id)
      if (!plant) throw new Error(`fixture element ${id} missing`)
      plant.initial_states = { ...plant.initial_states, health: 'thriving' }
    }
    const p3 = lvl.elements.find((e) => e.id === 'plant-3')
    if (!p3) throw new Error('plant-3 missing')
    p3.initial_states = { ...p3.initial_states, growth_stage: 'flowering' }
    return { gt, level: lvl }
  }

  it('TC-20/TC-32: won at t=0 → advanceTime is a no-op freeze; timerStatus stays readable', () => {
    const { gt, level: lvl } = wonFixture()
    const session = new GameSession(gt, lvl)
    expect(session.isWon()).toBe(true) // TC-32: initial snapshot is already over
    const before = JSON.stringify(session.getState())
    expect(session.advanceTime(5 * INTERVAL)).toEqual([]) // frozen: no plant decays
    expect(JSON.stringify(session.getState())).toBe(before)
    expect(session.timerStatus().length).toBeGreaterThan(0) // still readable
  })

  it('TC-30: timerStatus drives the per-pot ring — stagger, warning flip, pure read', () => {
    const gt = structuredClone(gameType)
    gt.timed_emitters = [decayEmitter({ warning_lead_ms: 300 })]
    const lvl = structuredClone(level)
    // Clear the shipped 60s stagger, then set test offsets against interval 1000.
    const offsets: Record<string, number> = { 'plant-1': 0, 'plant-2': 400, 'plant-3': 0 }
    for (const plant of lvl.elements) {
      if (offsets[plant.id] === undefined) continue
      plant.initial_states = { ...plant.initial_states, health: 'thriving' }
      plant.initial_timers = { decay: { offset_ms: offsets[plant.id] } }
    }
    const session = new GameSession(gt, lvl)
    session.advanceTime(500) // p1 charge 500, p2 charge 900 — neither crosses

    const st1 = session
      .timerStatus()
      .find((t) => t.elementId === 'plant-1' && t.emitterId === 'decay')
    const st2 = session
      .timerStatus()
      .find((t) => t.elementId === 'plant-2' && t.emitterId === 'decay')
    expect(st1?.msUntilTick).toBe(500)
    expect(st2?.msUntilTick).toBe(100) // staggered by offset 400
    expect(st1?.warning).toBe(false) // 500 > 300
    expect(st2?.warning).toBe(true) // 100 <= 300
    expect(st1?.warning).toBe((st1?.msUntilTick ?? 0) <= 300)

    // Pure read: no mutation, two consecutive reads identical.
    const stateBefore = JSON.stringify(session.getState())
    const readA = session.timerStatus()
    const readB = session.timerStatus()
    expect(readB).toEqual(readA)
    expect(JSON.stringify(session.getState())).toBe(stateBefore)
  })
})
