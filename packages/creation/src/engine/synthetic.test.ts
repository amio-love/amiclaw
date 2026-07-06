/**
 * Synthetic-fixture coverage for the two rule kinds rc-demo never exercises
 * (G5): a state_transition win driven by event-gated transitions, and an
 * interaction_matrix scoring path — both executed through the SHARED rule
 * core, asserting engine and solver agreement (G2). Also pins the G2
 * negative (no producible event → engine cannot play → solvability FAILS)
 * and the G6 state_effect guard (typo never silently advances).
 */

import { describe, expect, it } from 'vitest'
import type { GameType, Level, StateEffect } from '../schema/types'
import { checkSolvability } from '../validate/solvability'
import { validateGameType } from '../validate/validate'
import { startDeadline } from '../validate/helpers'
import { GameSession } from './engine'
import { applyStateEffect } from './rules'
import { searchSolution, solutionDriversForTarget } from './search'

// --- Synthetic fixture A: event-gated state_transition ("gate-lab") ---

const gateGameType: GameType = {
  id: 'gate-lab',
  version: '0.1.0',
  display_name: 'Gate Lab',
  description: 'Synthetic state_transition coverage fixture',
  co_play_form: 'co_build',
  element_archetypes: [
    {
      id: 'gate',
      category: 'spatial',
      verbal_label: { canonical: 'gate', phonetic_pinyin: 'zhá mén' },
      description: 'A switchable gate',
      attributes: [{ name: 'color', type: 'enum', required: true, values: ['red', 'blue'] }],
      states: [{ name: 'gate_state', type: 'enum', values: ['closed', 'open'], initial: 'closed' }],
      interaction_model: 'stateful',
    },
  ],
  rule_templates: [
    {
      id: 'gate_rule',
      type: 'state_transition',
      transition_table_schema: { states: ['closed', 'open'], events: ['switch_pressed'] },
      communication_weight: 1,
    },
  ],
  action_registry: [
    {
      name: 'press_switch',
      description: 'Press the gate switch',
      params: [{ name: 'action_type', type: 'string' }],
      scope: 'player_action',
    },
  ],
  action_event_mapping: [{ action_type: 'press', gate_rule_event: 'switch_pressed' }],
  information_partition_template: {
    roles: [
      {
        id: 'operator',
        display_name: 'Operator',
        verbal_label: 'operator',
        description: 'Presses switches',
        input_modality: 'visual',
        output_modality: 'action',
      },
    ],
    visibility_rules: [],
    rule_visibility: [],
    shared_label_attributes: [],
    action_capability: [
      { role: 'operator', can_perform: ['press_switch'], target_archetypes: ['gate'] },
    ],
    communication_channels: [],
    partition_pattern: 'ability_complement',
  },
  win_condition_type: { type: 'all_solved', description: 'Gate open' },
  difficulty_budget: {
    element_count: { min: 1, max: 4 },
    rule_count: { min: 1, max: 4 },
    partition_complexity: { max: 5 },
    weights: { element: 1, rule: 1, partition: 1 },
    total_score: { min: 0, max: 100 },
  },
  communication_budget: {
    max_round_trips: 5,
    estimated_seconds_per_round: 5,
    time_limit_seconds: 60,
    safety_margin: 0.8,
  },
  solver_strategy: 'exhaustive_path_search',
  solver_timeout_ms: 5000,
}

const gateLevel: Level = {
  metadata: {
    id: 'gate-001',
    game_type: 'gate-lab',
    game_type_version: '0.1.0',
    title: 'One gate',
    author: 'synthetic-test',
    created_at: '2026-07-04T00:00:00+08:00',
  },
  difficulty: { element_count: 1, rule_count: 1, partition_complexity: 0, total_score: 2 },
  communication_estimate: {
    round_trips: 1,
    estimated_seconds: 5,
    time_limit_seconds: 60,
    feasibility: 'feasible',
  },
  elements: [{ id: 'g1', archetype: 'gate', params: { color: 'red' } }],
  rules: [
    {
      id: 'r-gate',
      template: 'gate_rule',
      bindings: { transitions: [['closed', 'switch_pressed', 'open']] },
      target_elements: ['g1'],
    },
  ],
  information_partition: {
    role_assignments: [
      {
        role: 'operator',
        element_views: [{ element_id: 'g1', visible_attributes: ['*'], visible_states: ['*'] }],
      },
    ],
  },
  win_condition: { type: 'all_solved', params: { target_state: 'open', target_elements: ['g1'] } },
}

// --- Synthetic fixture B: interaction_matrix scoring path ("duet-lab") ---

const duetGameType: GameType = {
  id: 'duet-lab',
  version: '0.1.0',
  display_name: 'Duet Lab',
  description: 'Synthetic interaction_matrix coverage fixture',
  co_play_form: 'co_build',
  element_archetypes: [
    {
      id: 'piece',
      category: 'auditory',
      verbal_label: { canonical: 'piece', phonetic_pinyin: 'yuè jiàn' },
      description: 'A sound piece',
      attributes: [
        { name: 'kind', type: 'enum', required: true, values: ['drum', 'bell'] },
        { name: 'slot', type: 'enum', required: true, values: ['1', '2'] },
      ],
      states: [
        { name: 'resonance', type: 'enum', values: ['silent', 'resonant'], initial: 'silent' },
      ],
      interaction_model: 'reactive',
    },
  ],
  rule_templates: [
    {
      id: 'duet_rule',
      type: 'interaction_matrix',
      matrix_schema: {
        entity_types: ['drum', 'bell'],
        entity_type_attributes: ['kind'],
        pair_match_attributes: ['slot'], // only same-slot pairs are eligible (H2)
        relation_types: ['synergy'],
        effect_schema: [{ relation: 'synergy', effect: 'resonate', params: [] }],
      },
      communication_weight: 0.5,
    },
  ],
  action_registry: [
    {
      name: 'resonate',
      description: 'Resonance effect (engine-internal)',
      params: [],
      scope: 'rule_verb',
      state_effect: 'complete_state',
    },
    {
      name: 'strike',
      description: 'Strike a piece',
      params: [],
      scope: 'player_action',
      triggers: ['duet_rule'],
    },
  ],
  information_partition_template: {
    roles: [
      {
        id: 'player',
        display_name: 'Player',
        verbal_label: 'player',
        description: 'Strikes pieces',
        input_modality: 'auditory',
        output_modality: 'action',
      },
    ],
    visibility_rules: [],
    rule_visibility: [],
    shared_label_attributes: [],
    action_capability: [{ role: 'player', can_perform: ['strike'], target_archetypes: ['piece'] }],
    communication_channels: [],
    partition_pattern: 'ability_complement',
  },
  win_condition_type: { type: 'all_solved', description: 'All pieces resonant' },
  difficulty_budget: {
    element_count: { min: 1, max: 4 },
    rule_count: { min: 1, max: 4 },
    partition_complexity: { max: 5 },
    weights: { element: 1, rule: 1, partition: 1 },
    total_score: { min: 0, max: 100 },
  },
  communication_budget: {
    max_round_trips: 5,
    estimated_seconds_per_round: 5,
    time_limit_seconds: 60,
    safety_margin: 0.8,
  },
  solver_strategy: 'exhaustive_path_search',
  solver_timeout_ms: 5000,
}

const duetLevel: Level = {
  metadata: {
    id: 'duet-001',
    game_type: 'duet-lab',
    game_type_version: '0.1.0',
    title: 'Drum and bell',
    author: 'synthetic-test',
    created_at: '2026-07-04T00:00:00+08:00',
  },
  difficulty: { element_count: 3, rule_count: 1, partition_complexity: 0, total_score: 4 },
  communication_estimate: {
    round_trips: 1,
    estimated_seconds: 5,
    time_limit_seconds: 60,
    feasibility: 'feasible',
  },
  elements: [
    { id: 'p1', archetype: 'piece', params: { kind: 'drum', slot: '1' } },
    { id: 'p2', archetype: 'piece', params: { kind: 'bell', slot: '1' } },
    // Same kinds as p2 but a DIFFERENT slot: the (p1, p3) pair matches a
    // matrix row yet is pair-filter ineligible — it must never score.
    { id: 'p3', archetype: 'piece', params: { kind: 'bell', slot: '2' } },
  ],
  rules: [
    {
      id: 'r-duet',
      template: 'duet_rule',
      bindings: { matrix: [['drum', 'bell', 'synergy']] },
      target_elements: ['p1', 'p2', 'p3'],
    },
  ],
  information_partition: {
    role_assignments: [
      {
        role: 'player',
        element_views: [
          { element_id: 'p1', visible_attributes: ['*'], visible_states: ['*'] },
          { element_id: 'p2', visible_attributes: ['*'], visible_states: ['*'] },
          { element_id: 'p3', visible_attributes: ['*'], visible_states: ['*'] },
        ],
      },
    ],
  },
  win_condition: {
    type: 'all_solved',
    params: { target_state: 'resonant', target_elements: ['p1', 'p2'] },
  },
}

describe('synthetic state_transition (gate-lab)', () => {
  it('engine plays the event-gated transition to the win', () => {
    const session = new GameSession(gateGameType, gateLevel)
    expect(session.getState().elements.g1.gate_state).toBe('closed')
    const result = session.performAction('operator', 'press_switch', {
      element_id: 'g1',
      action_type: 'press',
    })
    expect(result.ok).toBe(true)
    expect(session.getState().elements.g1.gate_state).toBe('open')
    expect(session.isWon()).toBe(true)
  })

  it('solver agrees with the engine through the shared core', () => {
    const search = searchSolution(gateGameType, gateLevel)
    expect(search.solvable).toBe(true)
    expect(search.path).toEqual(['r-gate'])
    expect(checkSolvability(gateGameType, gateLevel).verdict).toBe('pass')
  })

  it('G2: no producible event → engine cannot play AND solvability fails', () => {
    const unplayable = structuredClone(gateGameType)
    unplayable.action_event_mapping = []
    // Engine: the action succeeds but nothing can fire the transition.
    const session = new GameSession(unplayable, gateLevel)
    const result = session.performAction('operator', 'press_switch', {
      element_id: 'g1',
      action_type: 'press',
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.effects).toEqual([])
    expect(session.getState().elements.g1.gate_state).toBe('closed')
    expect(session.isWon()).toBe(false)
    // Solver: event-gated moves mean the search agrees — NOT solvable.
    expect(searchSolution(unplayable, gateLevel).solvable).toBe(false)
    const check = checkSolvability(unplayable, gateLevel)
    expect(check.verdict).toBe('fail')
    expect(check.violations.some((v) => v.constraint === 'solution_path_exists')).toBe(true)
  })

  it('G3: driver analysis reports timeout instead of a partial count', () => {
    const analysis = solutionDriversForTarget(gateGameType, gateLevel, 'g1', startDeadline(0))
    expect(analysis.timedOut).toBe(true)
  })

  it('F1: a mapping row alone is not producible — the event needs an action_type-declaring action on the archetype', () => {
    // press_switch stops declaring an action_type param: the mapping row
    // (press → switch_pressed) survives, but the engine has NO path to carry
    // an action_type, so the event can never fire. Pre-fix the solver treated
    // every mapping event as producible whenever SOME action could target the
    // gate — a false-positive publishability hole for state_transition.
    const undrivable = structuredClone(gateGameType)
    undrivable.action_registry[0].params = []

    // Engine: a smuggled action_type is rejected; a bare press fires nothing.
    const session = new GameSession(undrivable, gateLevel)
    const smuggled = session.performAction('operator', 'press_switch', {
      element_id: 'g1',
      action_type: 'press',
    })
    expect(smuggled.ok).toBe(false)
    expect(!smuggled.ok && smuggled.reason).toContain('action_type')
    const bare = session.performAction('operator', 'press_switch', { element_id: 'g1' })
    expect(bare.ok).toBe(true)
    expect(bare.ok && bare.effects).toEqual([])
    expect(session.getState().elements.g1.gate_state).toBe('closed')

    // Solver agrees through the event-drivable gate: NOT solvable.
    expect(searchSolution(undrivable, gateLevel).solvable).toBe(false)
    const check = checkSolvability(undrivable, gateLevel)
    expect(check.verdict).toBe('fail')
    expect(check.violations.some((v) => v.constraint === 'solution_path_exists')).toBe(true)
  })
})

describe('synthetic interaction_matrix (duet-lab)', () => {
  it('engine applies the pair effect to both members and wins', () => {
    const session = new GameSession(duetGameType, duetLevel)
    const result = session.performAction('player', 'strike', { element_id: 'p1' })
    expect(result.ok).toBe(true)
    expect(session.getState().elements.p1.resonance).toBe('resonant')
    expect(session.getState().elements.p2.resonance).toBe('resonant')
    expect(session.isWon()).toBe(true)
  })

  it('H2: the pair filter blocks cross-slot pairs (same kinds, different slot)', () => {
    const session = new GameSession(duetGameType, duetLevel)
    session.performAction('player', 'strike', { element_id: 'p1' })
    // (p1, p3) matches the drum×bell matrix row but sits on another slot:
    // pair_match_attributes [slot] keeps it out of the lookup.
    expect(session.getState().elements.p1.resonance).toBe('resonant')
    expect(session.getState().elements.p2.resonance).toBe('resonant')
    expect(session.getState().elements.p3.resonance).toBe('silent')
  })

  it('solver agrees with the engine through the shared core', () => {
    const search = searchSolution(duetGameType, duetLevel)
    expect(search.solvable).toBe(true)
    expect(search.path).toEqual(['r-duet'])
    expect(checkSolvability(duetGameType, duetLevel).verdict).toBe('pass')
  })

  it('H2: pair_match_attributes must exist on the participating archetypes', () => {
    const badGameType = structuredClone(duetGameType)
    const template = badGameType.rule_templates[0]
    if (template.type !== 'interaction_matrix') throw new Error('fixture template kind')
    template.matrix_schema.pair_match_attributes = ['tempo']
    const result = validateGameType(badGameType)
    expect(result.verdict).toBe('fail')
    const violation = result.violations.find(
      (v) => v.field_path === 'game_type.rule_templates[0].matrix_schema.pair_match_attributes[0]'
    )
    expect(violation?.constraint).toBe('attribute_defined')
    expect(violation?.actual).toContain('piece')
  })

  it('G6: a typo’d state_effect never silently advances state', () => {
    const badGameType = structuredClone(duetGameType)
    badGameType.action_registry[0].state_effect = 'complte_state' as StateEffect
    const session = new GameSession(badGameType, duetLevel)
    session.performAction('player', 'strike', { element_id: 'p1' })
    expect(session.getState().elements.p1.resonance).toBe('silent')
    expect(session.isWon()).toBe(false)
    // The solver, sharing the core, agrees the level is now unplayable.
    expect(searchSolution(badGameType, duetLevel).solvable).toBe(false)
  })

  it('G6: an unknown CURRENT state value is a no-op, never laundered into progress', () => {
    // A typo'd GameType state initial ('siilent' ∉ values) used to become
    // real progress: advance_state computed index -1 → values[0], and
    // complete_state jumped straight to the terminal value.
    const badGameType = structuredClone(duetGameType)
    const typoState = badGameType.element_archetypes[0].states?.[0]
    if (!typoState) throw new Error('fixture state missing')
    typoState.initial = 'siilent'
    const session = new GameSession(badGameType, duetLevel)
    session.performAction('player', 'strike', { element_id: 'p1' }) // resonate = complete_state
    expect(session.getState().elements.p1.resonance).toBe('siilent') // NOT 'resonant'
    expect(session.isWon()).toBe(false)
    expect(searchSolution(badGameType, duetLevel).solvable).toBe(false)

    // advance_state unit: unknown current must not launder into values[0].
    const archetype = duetGameType.element_archetypes[0]
    const machine = new Map<string, unknown>([['resonance', 'siilent']])
    expect(applyStateEffect(archetype, machine, 'advance_state')).toBe(false)
    expect(machine.get('resonance')).toBe('siilent')
  })
})
