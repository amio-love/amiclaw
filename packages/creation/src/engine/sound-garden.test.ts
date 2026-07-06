/**
 * Sound Garden (co_build) engine integration on the REAL vocabulary:
 * scripted placement sequence to the winning score, noise-pair penalty,
 * capability-split enforcement, construction-model isolation from role
 * views, and engine-backed search agreement.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import { startDeadline } from '../validate/helpers'
import { GameSession } from './engine'
import { PLACEMENT_STATE } from './rules'
import { searchSolution } from './search'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'sound-garden'
)
const gameType = loadGameType(readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(fixturesDir, 'level.sg-demo-001.yaml'), 'utf8'))

describe('GameSession — scripted sg-demo-001 build to win', () => {
  it('builds the garden to the winning score through paired placements', () => {
    const session = new GameSession(gameType, level)
    expect(session.isWon()).toBe(false)
    expect(session.score()).toBe(0)

    // Step 1: kick + bell on slot 1 — synergy (+3).
    expect(session.performAction('rhythm_builder', 'place_piece', { element_id: 'r1' }).ok).toBe(
      true
    )
    expect(session.score()).toBe(0) // rhythm alone: no pair yet
    session.performAction('melody_builder', 'place_piece', { element_id: 'm1' })
    expect(session.score()).toBe(3)

    // Steps 2-3: snare+chime, hihat+flute — two more synergies.
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r2' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm2' })
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r3' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm3' })
    expect(session.score()).toBe(9)
    expect(session.isWon()).toBe(false) // 9 < 10

    // Step 4: clap + harp — crosses the threshold.
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r4' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm4' })
    expect(session.score()).toBe(12)
    expect(session.isWon()).toBe(true)
  })

  it('enforces the ability split: builders cannot place the other role’s pieces', () => {
    const session = new GameSession(gameType, level)
    const wrong = session.performAction('rhythm_builder', 'place_piece', { element_id: 'm1' })
    expect(wrong.ok).toBe(false)
    expect(!wrong.ok && wrong.reason).toContain('melody_piece')
  })

  it('F4: place_piece (a construction action) without a target element is malformed', () => {
    const session = new GameSession(gameType, level)
    const missing = session.performAction('rhythm_builder', 'place_piece', {})
    expect(missing.ok).toBe(false)
    expect(!missing.ok && missing.reason).toContain('target element')
  })

  it('a noise pair (snare+flute on one slot) reduces the score per the matrix', () => {
    const noisy = structuredClone(level)
    const m3 = noisy.elements.find((element) => element.id === 'm3')
    if (!m3) throw new Error('fixture element missing')
    m3.params.timeline_slot = 3 // move the flute onto the snare's slot
    const session = new GameSession(gameType, noisy)
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r1' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm1' })
    expect(session.score()).toBe(3)
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r2' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm3' })
    expect(session.score()).toBe(2) // 3 + (snare×flute incompatible = -1)
  })

  it('remove_piece takes a placement back', () => {
    const session = new GameSession(gameType, level)
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r1' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm1' })
    expect(session.score()).toBe(3)
    session.performAction('melody_builder', 'remove_piece', { element_id: 'm1' })
    expect(session.score()).toBe(0)
  })

  it('computes the spec remaining-steps metric (M4)', () => {
    const session = new GameSession(gameType, level)
    expect(session.remainingSteps()).toBe(4) // 8 empty slots, 4 formable pairs
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r1' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm1' })
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r2' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm2' })
    session.performAction('rhythm_builder', 'place_piece', { element_id: 'r3' })
    session.performAction('melody_builder', 'place_piece', { element_id: 'm3' })
    // Spec worked example: 3 pairs placed scoring 9 → remaining_steps = 1.
    expect(session.score()).toBe(9)
    expect(session.remainingSteps()).toBe(1)
  })

  it('never exposes the reserved placement key through role views', () => {
    const session = new GameSession(gameType, level)
    for (const roleId of ['rhythm_builder', 'melody_builder']) {
      for (const element of session.getRoleView(roleId).elements) {
        expect(element.visible_states).not.toHaveProperty(PLACEMENT_STATE)
      }
    }
  })
})

describe('engine-backed search on sg-demo-001', () => {
  it('finds a construction path to the winning score', () => {
    const result = searchSolution(gameType, level)
    expect(result.solvable).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.path.length).toBe(8) // all four pairs must land to cross 10
    for (const step of result.path) {
      expect(step.startsWith('place:')).toBe(true)
    }
  })

  it('reports unsolvable when the target exceeds the best possible build', () => {
    const impossible = structuredClone(level)
    impossible.win_condition.params.target_score = 99
    const result = searchSolution(gameType, impossible, startDeadline(5000))
    expect(result.solvable).toBe(false)
    expect(result.timedOut).toBe(false)
  })
})
