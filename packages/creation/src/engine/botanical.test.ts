/**
 * Botanical Garden (hidden_info_coop) engine integration on the largest
 * vocabulary, all through the SHARED rule core: per-instance initial states,
 * the stateful multi-entity care loop (state_transition health/growth/light +
 * condition_action healing), optimization_target win, wrong-care degradation,
 * role-filtered views, and engine-backed csp search agreement.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import { searchSolution } from './search'
import { GameSession } from './engine'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'botanical-garden'
)
const gameType = loadGameType(readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(fixturesDir, 'level.bg-demo-001.yaml'), 'utf8'))

describe('GameSession — per-instance initial states', () => {
  it('applies each element’s initial_states over the archetype defaults', () => {
    const session = new GameSession(gameType, level)
    const s = session.getState().elements
    // plant-1 (fern): wilting + inherited partial_shade; plant-3 (orchid):
    // wilting + full_sun; plant-2 (succulent): stable + full_sun.
    expect(s['plant-1'].health).toBe('wilting')
    expect(s['plant-1'].effective_light).toBe('partial_shade')
    expect(s['plant-2'].health).toBe('stable')
    expect(s['plant-3'].health).toBe('wilting')
    expect(s['plant-3'].effective_light).toBe('full_sun')
    // growth defaults to the archetype initial (seedling) for all.
    expect(s['plant-1'].growth_stage).toBe('seedling')
  })
})

describe('GameSession — scripted care loop to win (bg-demo-001)', () => {
  it('heals, shades, and grows plants to satisfy optimization_target', () => {
    const session = new GameSession(gameType, level)
    expect(session.isWon()).toBe(false)

    // Fern is wilting: water heals it via health_response correct_care.
    expect(
      session.performAction('gardener', 'apply_care', {
        element_id: 'plant-1',
        action_type: 'water',
      }).ok
    ).toBe(true)
    expect(session.getState().elements['plant-1'].health).toBe('stable')

    // Orchid: shade sets effective_light partial_shade AND the condition_action
    // rule-orchid-care heals it in the same care action.
    session.performAction('gardener', 'apply_care', { element_id: 'plant-3', action_type: 'shade' })
    expect(session.getState().elements['plant-3'].effective_light).toBe('partial_shade')
    expect(session.getState().elements['plant-3'].health).toBe('stable')

    // Grow the orchid to flowering.
    session.performAction('gardener', 'apply_care', {
      element_id: 'plant-3',
      action_type: 'fertilize',
    })
    expect(session.getState().elements['plant-3'].growth_stage).toBe('juvenile')
    session.performAction('gardener', 'apply_care', { element_id: 'plant-3', action_type: 'repot' })
    expect(session.getState().elements['plant-3'].growth_stage).toBe('mature')
    expect(session.isWon()).toBe(false) // not flowering yet
    session.performAction('gardener', 'apply_care', { element_id: 'plant-3', action_type: 'bloom' })
    expect(session.getState().elements['plant-3'].growth_stage).toBe('flowering')

    // optimization_target: all plants >= stable AND >= 1 flowering.
    expect(session.isWon()).toBe(true)
    expect(session.getState().won).toBe(true)
  })

  it('wrong care degrades health per the health_response table', () => {
    const session = new GameSession(gameType, level)
    expect(session.getState().elements['plant-2'].health).toBe('stable')
    // overwater maps to wrong_care: stable -> wilting.
    session.performAction('gardener', 'apply_care', {
      element_id: 'plant-2',
      action_type: 'overwater',
    })
    expect(session.getState().elements['plant-2'].health).toBe('wilting')
    expect(session.isWon()).toBe(false)
  })

  it('enforces role capability: the botanist cannot apply care', () => {
    const session = new GameSession(gameType, level)
    const wrong = session.performAction('botanist', 'apply_care', {
      element_id: 'plant-1',
      action_type: 'water',
    })
    expect(wrong.ok).toBe(false)
  })

  it('F4: apply_care without its declared action_type param is a malformed call', () => {
    const session = new GameSession(gameType, level)
    const missing = session.performAction('gardener', 'apply_care', { element_id: 'plant-1' })
    expect(missing.ok).toBe(false)
    expect(!missing.ok && missing.reason).toContain('action_type')
    // No state drift from the rejected call.
    expect(session.getState().elements['plant-1'].health).toBe('wilting')
  })

  it('does not mutate the GameType or Level inputs', () => {
    const gameTypeBefore = JSON.stringify(gameType)
    const levelBefore = JSON.stringify(level)
    const session = new GameSession(gameType, level)
    session.performAction('gardener', 'apply_care', { element_id: 'plant-1', action_type: 'water' })
    session.getRoleView('gardener')
    session.getRoleView('botanist')
    expect(JSON.stringify(gameType)).toBe(gameTypeBefore)
    expect(JSON.stringify(level)).toBe(levelBefore)
  })
})

describe('B: describe/forged actions are inert on game state (F1 + non-forgeable action_type)', () => {
  it('a bare describe_state (pure communication) NEVER heals a plant', () => {
    const session = new GameSession(gameType, level)
    // Shade the orchid so rule-orchid-care's condition holds (partial_shade).
    session.performAction('gardener', 'apply_care', { element_id: 'plant-3', action_type: 'shade' })
    expect(session.getState().elements['plant-3'].health).toBe('stable')
    // The exploit: keep "describing" the plant — a params:[] communication
    // action that triggers no rule — and it must never ratchet health up.
    for (let i = 0; i < 4; i++) {
      const result = session.performAction('gardener', 'describe_state', { element_id: 'plant-3' })
      expect(result.ok).toBe(true)
      expect(result.ok && result.effects).toEqual([])
    }
    expect(session.getState().elements['plant-3'].health).toBe('stable') // never thriving
  })

  it('a smuggled action_type on describe_state is rejected (non-forgeable)', () => {
    const session = new GameSession(gameType, level)
    const before = session.getState().elements['plant-1'].health
    // describe_state declares no action_type param: smuggling water must fail…
    const forged = session.performAction('gardener', 'describe_state', {
      element_id: 'plant-1',
      action_type: 'water',
    })
    expect(forged.ok).toBe(false)
    expect(!forged.ok && forged.reason).toContain('action_type')
    // …and leave the plant exactly as it was (no smuggled heal).
    expect(session.getState().elements['plant-1'].health).toBe(before)
  })

  it('a mismatched action_type on apply_care fires no state_transition rule', () => {
    const session = new GameSession(gameType, level)
    // apply_care legitimately carries action_type, but a nonsense value maps
    // to no action_event_mapping event, so no health/growth/light rule fires.
    const result = session.performAction('gardener', 'apply_care', {
      element_id: 'plant-1',
      action_type: 'bogus_care',
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.effects).toEqual([]) // no event → no transition
    expect(session.getState().elements['plant-1'].health).toBe('wilting') // unchanged
  })
})

describe('GameSession — botanical role-filtered views', () => {
  const session = new GameSession(gameType, level)

  it('the gardener sees the scene + live states but not soil_type', () => {
    const view = session.getRoleView('gardener')
    const plant1 = view.elements.find((e) => e.element_id === 'plant-1')
    expect(plant1?.visible_params).toHaveProperty('species')
    expect(plant1?.visible_params).toHaveProperty('pot_position')
    expect(plant1?.visible_params).not.toHaveProperty('soil_type')
    expect(plant1?.visible_states).toHaveProperty('health')
    expect(plant1?.visible_states).toHaveProperty('effective_light')
    expect(view.visible_rules).toEqual([]) // gardener holds no manual
    expect(view.can_perform).toEqual(['apply_care', 'describe_state'])
  })

  it('the botanist sees species + soil + the care manual but no scene states', () => {
    const view = session.getRoleView('botanist')
    const plant1 = view.elements.find((e) => e.element_id === 'plant-1')
    expect(plant1?.visible_params).toHaveProperty('soil_type')
    expect(plant1?.visible_params).not.toHaveProperty('pot_position')
    expect(plant1?.visible_states).toEqual({})
    expect(view.visible_rules).toContain('rule-orchid-care')
    expect(view.visible_rules).toContain('rule-health')
  })

  it('leak test: no cannot_see field appears on the wrong role’s view', () => {
    const template = gameType.information_partition_template
    if (!template) throw new Error('fixture partition template missing')
    // The botanist must never see pot_position or any plant runtime state.
    const botanist = session.getRoleView('botanist')
    for (const element of botanist.elements) {
      expect(element.visible_params).not.toHaveProperty('pot_position')
      expect(element.visible_states).toEqual({})
    }
    // The gardener must never see soil_type.
    const gardener = session.getRoleView('gardener')
    for (const element of gardener.elements) {
      expect(element.visible_params).not.toHaveProperty('soil_type')
    }
  })
})

describe('engine-backed csp search on bg-demo-001', () => {
  it('finds a care path to the optimization target', () => {
    const result = searchSolution(gameType, level)
    expect(result.solvable).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.path.length).toBeGreaterThan(0)
  })

  it('reports unsolvable (fast, clean exhaustion) when flowering is structurally unreachable', () => {
    // Remove the growth rule: no rule advances growth_stage, so flowering can
    // never be reached. The remaining search space (health × light) is small,
    // so exhaustion is fast and deterministic (no timeout boundary flake).
    const impossible = structuredClone(level)
    impossible.rules = impossible.rules.filter((r) => r.id !== 'rule-growth')
    const result = searchSolution(gameType, impossible)
    expect(result.solvable).toBe(false)
    expect(result.timedOut).toBe(false)
  })
})
