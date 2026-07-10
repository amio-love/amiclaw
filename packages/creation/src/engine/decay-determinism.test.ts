/**
 * Timed decay determinism property (§2, §6): advanceTime reads NO wall-clock,
 * so the same interleaved (advanceTime, performAction) sequence over the same
 * (GameType, Level) always yields the same state — the backbone the host's
 * replay + solver-purity claims rest on. Also pins the documented once-per-
 * advance tick cap as a deliberate non-associativity boundary (TC-27).
 *
 * Covers test-design case TC-23 (+ the TC-27 associativity boundary as a
 * property).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import type { GameType, Level } from '../schema/types'
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

function decayFixture(): { gt: GameType; level: Level } {
  const gt = structuredClone(gameType)
  gt.timed_emitters = [
    {
      id: 'decay',
      event: 'neglect',
      target_template: 'health_response',
      target: { kind: 'all' },
      interval_ms: INTERVAL,
      warning_lead_ms: 200,
    },
  ]
  const lvl = structuredClone(level)
  // Clear the shipped 60s stagger so the sequence's 1s-scale dt is meaningful;
  // seed plant-1/plant-2 thriving and leave plant-3 wilting so it decays to
  // death mid-sequence (this exercises decay + lose determinism together).
  for (const plant of lvl.elements) {
    if (plant.archetype !== 'plant') continue
    delete plant.initial_timers
    if (plant.id === 'plant-1' || plant.id === 'plant-2') {
      plant.initial_states = { ...plant.initial_states, health: 'thriving' }
    }
  }
  return { gt, level: lvl }
}

/** One interleaving of decay ticks and player care, exercising fire + heal + degrade. */
function runSequence(session: GameSession): void {
  session.advanceTime(300)
  session.performAction('gardener', 'apply_care', { element_id: 'plant-1', action_type: 'water' })
  session.advanceTime(1200) // crosses on plant-1
  session.performAction('gardener', 'apply_care', {
    element_id: 'plant-2',
    action_type: 'overwater',
  })
  session.advanceTime(1500)
  session.performAction('gardener', 'apply_care', { element_id: 'plant-1', action_type: 'water' })
  session.advanceTime(700)
}

describe('advanceTime determinism / replay (TC-23)', () => {
  it('two fresh sessions running the same sequence reach byte-identical state', () => {
    const fa = decayFixture()
    const a = new GameSession(fa.gt, fa.level)
    const fb = decayFixture()
    const b = new GameSession(fb.gt, fb.level)
    runSequence(a)
    runSequence(b)
    expect(a.getState()).toEqual(b.getState())
    expect(a.timerStatus()).toEqual(b.timerStatus())
    // The sequence drives plant-3 to death — determinism spans decay + lose.
    expect(a.isLost()).toBe(true)
    expect(a.isLost()).toBe(b.isLost())
  })

  it('three independent replays are all mutually equal (no hidden clock state)', () => {
    const states = [0, 1, 2].map(() => {
      const f = decayFixture()
      const s = new GameSession(f.gt, f.level)
      runSequence(s)
      return s.getState()
    })
    expect(states[1]).toEqual(states[0])
    expect(states[2]).toEqual(states[0])
  })

  it('TC-27 property: summed dt is NOT associative across a tick boundary (documented cap)', () => {
    const fa = decayFixture()
    const bigStep = new GameSession(fa.gt, fa.level)
    bigStep.advanceTime(3 * INTERVAL) // one fire (cap)

    const fb = decayFixture()
    const smallSteps = new GameSession(fb.gt, fb.level)
    for (let i = 0; i < 3; i++) smallSteps.advanceTime(INTERVAL) // three fires

    expect(bigStep.getState()).not.toEqual(smallSteps.getState())
  })
})
