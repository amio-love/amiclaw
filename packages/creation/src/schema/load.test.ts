/**
 * Fixture-loading tests: the Radio Cipher fixtures load without error and
 * conform to the meta-model type contracts (spot-asserted on key fields per
 * the R1 acceptance sketch); malformed documents produce clear load errors.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel, SchemaLoadError } from './load'
import { SEED_CO_PLAY_FORM_CATALOG } from './types'
import type { GameType, Level } from './types'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'radio-cipher'
)

const gameTypeYaml = readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8')
const levelYaml = readFileSync(join(fixturesDir, 'level.rc-demo-001.yaml'), 'utf8')

describe('loadGameType (radio-cipher fixture)', () => {
  const gameType: GameType = loadGameType(gameTypeYaml)

  it('loads the vocabulary and identifies the game type', () => {
    expect(gameType.id).toBe('radio-cipher')
    expect(gameType.version).toBe('1.0.0')
    expect(gameType.display_name).toBe('密码电台')
  })

  it('declares the hidden_info_coop co-play form, present in the seed catalog', () => {
    expect(gameType.co_play_form).toBe('hidden_info_coop')
    const form = SEED_CO_PLAY_FORM_CATALOG.find((f) => f.id === gameType.co_play_form)
    expect(form?.floor_checks).toEqual(['communication_completeness', 'verbal_distinguishability'])
  })

  it('registers the three element archetypes', () => {
    expect(gameType.element_archetypes.map((a) => a.id)).toEqual([
      'cipher_segment',
      'cipher_key',
      'frequency_hint',
    ])
    const segment = gameType.element_archetypes[0]
    expect(segment.category).toBe('auditory')
    expect(segment.verbal_label.canonical).toBe('密文段')
    expect(segment.interaction_model).toBe('stateful')
    const contentLength = segment.attributes.find((a) => a.name === 'content_length')
    expect(contentLength?.type).toBe('enum')
    expect(contentLength?.values).toEqual(['short', 'medium', 'long'])
    expect(contentLength?.display_labels).toEqual({ short: '短', medium: '中等', long: '长' })
  })

  it('registers the rule templates with their declarative kinds', () => {
    const kinds = Object.fromEntries(gameType.rule_templates.map((t) => [t.id, t.type]))
    expect(kinds).toEqual({
      decrypt_step: 'temporal_sequence',
      reverse_decrypt: 'temporal_sequence',
      verification_check: 'condition_action',
    })
  })

  it('narrows rule templates through the discriminated union', () => {
    const decryptStep = gameType.rule_templates.find((t) => t.id === 'decrypt_step')
    expect(decryptStep?.type).toBe('temporal_sequence')
    if (decryptStep?.type === 'temporal_sequence') {
      expect(decryptStep.sequence_schema.max_steps).toBe(5)
      expect(decryptStep.sequence_schema.ordering).toBe('strict')
      expect(decryptStep.sequence_schema.step_schema.action).toBe('apply_key')
      expect(decryptStep.communication_weight).toBe(2.0)
    }
    const verify = gameType.rule_templates.find((t) => t.id === 'verification_check')
    expect(verify?.type).toBe('condition_action')
    if (verify?.type === 'condition_action') {
      expect(verify.condition_schema.predicates[0].name).toBe('plaintext_is_valid_word')
      expect(verify.condition_schema.combinators).toEqual(['AND'])
      expect(verify.action_schema.verbs).toEqual(['confirm_decryption', 'retry_decryption'])
    }
  })

  it('declares the information partition roles and pattern', () => {
    const partition = gameType.information_partition_template
    expect(partition?.roles.map((r) => r.id)).toEqual(['listener', 'decoder'])
    expect(partition?.partition_pattern).toBe('describe_execute')
    expect(partition?.shared_label_attributes).toEqual([
      { element_archetype: 'cipher_segment', attributes: ['content_length'] },
    ])
  })

  it('declares the action registry with scopes and the budgets', () => {
    const applyKey = gameType.action_registry.find((a) => a.name === 'apply_key')
    expect(applyKey?.scope).toBe('rule_verb')
    expect(applyKey?.params).toEqual([
      { name: 'cipher_segment_id', type: 'string' },
      { name: 'cipher_key_id', type: 'string' },
    ])
    expect(gameType.win_condition_type.type).toBe('all_solved')
    expect(gameType.difficulty_budget.element_count).toEqual({ min: 3, max: 12 })
    expect(gameType.communication_budget.max_round_trips).toBe(15)
    expect(gameType.communication_budget.safety_margin).toBe(0.8)
  })
})

describe('loadGameType (partition-optional forms)', () => {
  // Minimal synthetic co_build vocabulary: shared-state forms may omit
  // information_partition_template entirely (spec Mechanism 1). Guards
  // against a regression re-adding it to GAME_TYPE_REQUIRED_FIELDS.
  const coBuildYaml = [
    'GameType:',
    '  id: co-build-minimal',
    "  version: '0.1.0'",
    '  display_name: Minimal Co-Build',
    '  description: Synthetic minimal co_build vocabulary for loader tests',
    '  co_play_form: co_build',
    '  element_archetypes:',
    '    - id: block',
    '      category: spatial',
    '      verbal_label:',
    '        canonical: block',
    "        phonetic_pinyin: 'fāng kuài'",
    '      description: A stackable building block',
    '      attributes:',
    '        - name: size',
    '          type: enum',
    '          required: true',
    '          values: [small, large]',
    '      interaction_model: stateless',
    '  rule_templates:',
    '    - id: stack_step',
    '      type: temporal_sequence',
    '      sequence_schema:',
    '        max_steps: 3',
    '        step_schema:',
    '          action: place_block',
    '          params: []',
    '        ordering: flexible',
    '      communication_weight: 1.0',
    '  win_condition_type:',
    '    type: score_threshold',
    '    description: Structure height reaches the target score',
    '  difficulty_budget:',
    '    element_count: { min: 1, max: 4 }',
    '    rule_count: { min: 1, max: 2 }',
    '    partition_complexity: { max: 1.0 }',
    '    weights: { element: 1.0, rule: 1.0, partition: 1.0 }',
    '    total_score: { min: 1.0, max: 10.0 }',
    '  action_registry:',
    '    - name: place_block',
    '      description: Place a block on the structure',
    '      params: []',
    '      scope: both',
    '  communication_budget:',
    '    max_round_trips: 5',
    '    estimated_seconds_per_round: 10.0',
    '    time_limit_seconds: 120',
    '    safety_margin: 0.8',
    '  solver_strategy: exhaustive_path_search',
    '  solver_timeout_ms: 5000',
    '',
  ].join('\n')

  it('loads a GameType without information_partition_template', () => {
    const gameType: GameType = loadGameType(coBuildYaml)
    expect(gameType.id).toBe('co-build-minimal')
    expect(gameType.co_play_form).toBe('co_build')
    expect(gameType.information_partition_template).toBeUndefined()
    expect(gameType.element_archetypes.map((a) => a.id)).toEqual(['block'])
    expect(gameType.rule_templates[0].type).toBe('temporal_sequence')
    expect(gameType.win_condition_type.type).toBe('score_threshold')
  })
})

describe('loadLevel (rc-demo-001 fixture)', () => {
  const gameType: GameType = loadGameType(gameTypeYaml)
  const level: Level = loadLevel(levelYaml)

  it('loads the level metadata with an exact game-type version binding', () => {
    expect(level.metadata.id).toBe('rc-demo-001')
    expect(level.metadata.game_type).toBe(gameType.id)
    expect(level.metadata.game_type_version).toBe(gameType.version)
  })

  it('instantiates elements from registered archetypes', () => {
    expect(level.elements.map((e) => e.id)).toEqual(['seg-1', 'seg-2', 'key-1', 'hint-1', 'hint-2'])
    const archetypeIds = new Set(gameType.element_archetypes.map((a) => a.id))
    for (const element of level.elements) {
      expect(archetypeIds).toContain(element.archetype)
    }
    const seg1 = level.elements[0]
    expect(seg1.params).toEqual({ content_length: 'short', plaintext_category: 'animal' })
    expect(seg1.position).toEqual({ slot: 1 })
    const key1 = level.elements.find((e) => e.id === 'key-1')
    expect(key1?.params).toEqual({ target_method: 'caesar_shift', shift_amount: 3 })
    expect(key1?.position).toBeUndefined()
  })

  it('binds rules to registered templates', () => {
    expect(level.rules.map((r) => r.template)).toEqual([
      'decrypt_step',
      'reverse_decrypt',
      'verification_check',
    ])
    const verify = level.rules.find((r) => r.id === 'rule-verify')
    expect(verify?.bindings).toEqual({
      predicates: [{ name: 'plaintext_is_valid_word', category: 'animal' }],
      combinator: 'AND',
      action: { verb: 'confirm_decryption' },
    })
    expect(verify?.target_elements).toEqual(['seg-1'])
  })

  it('assigns per-role element views in the information partition', () => {
    const roles = level.information_partition.role_assignments.map((a) => a.role)
    expect(roles).toEqual(['listener', 'decoder'])
    const listener = level.information_partition.role_assignments[0]
    expect(listener.element_views).toHaveLength(2)
    expect(listener.element_views[0]).toEqual({
      element_id: 'seg-1',
      visible_attributes: ['content_length'],
      visible_states: ['decryption_progress'],
    })
  })

  it('carries the difficulty, communication estimate, and win condition', () => {
    expect(level.difficulty).toEqual({
      element_count: 5,
      rule_count: 3,
      partition_complexity: 3.71,
      total_score: 16.92,
    })
    expect(level.communication_estimate.feasibility).toBe('feasible')
    expect(level.win_condition.type).toBe('all_solved')
    expect(level.win_condition.params).toEqual({
      target_state: 'decrypted',
      target_elements: ['seg-1', 'seg-2'],
    })
  })
})

describe('malformed documents', () => {
  it('rejects a GameType document missing required top-level fields', () => {
    const malformed = ['GameType:', '  id: broken-game', '  display_name: Broken', ''].join('\n')
    expect(() => loadGameType(malformed)).toThrow(SchemaLoadError)
    expect(() => loadGameType(malformed)).toThrow(/missing required field\(s\).*version/)
  })

  it('rejects a document without the expected root key', () => {
    expect(() => loadGameType(levelYaml)).toThrow(/Missing top-level "GameType" key/)
    expect(() => loadLevel(gameTypeYaml)).toThrow(/Missing top-level "Level" key/)
  })

  it('rejects a document with extra sibling root keys', () => {
    const malformed = ['GameType:', '  id: broken-game', 'Sidecar:', '  stray: true', ''].join('\n')
    expect(() => loadGameType(malformed)).toThrow(SchemaLoadError)
    expect(() => loadGameType(malformed)).toThrow(
      /Expected "GameType" to be the only root key, found extra root key\(s\): Sidecar/
    )
  })

  it('rejects a Level document missing required top-level fields', () => {
    const malformed = [
      'Level:',
      '  metadata:',
      '    id: broken-level',
      '    game_type: radio-cipher',
      "    game_type_version: '1.0.0'",
      '    title: Broken',
      '    author: nobody',
      "    created_at: '2026-07-02T22:00:00+08:00'",
      '',
    ].join('\n')
    expect(() => loadLevel(malformed)).toThrow(SchemaLoadError)
    expect(() => loadLevel(malformed)).toThrow(
      /missing required field\(s\).*elements.*rules.*win_condition/
    )
  })

  it('rejects a Level document with incomplete metadata', () => {
    const malformed = [
      'Level:',
      '  metadata:',
      '    id: broken-level',
      '  difficulty: {}',
      '  communication_estimate: {}',
      '  elements: []',
      '  rules: []',
      '  information_partition: {}',
      '  win_condition: {}',
      '',
    ].join('\n')
    expect(() => loadLevel(malformed)).toThrow(/Level metadata.*game_type_version/)
  })

  it('rejects non-mapping and syntactically invalid YAML with clear errors', () => {
    expect(() => loadGameType('just a scalar')).toThrow(
      /Expected a YAML mapping with a top-level "GameType" key/
    )
    expect(() => loadGameType('GameType: [not, a, mapping]')).toThrow(
      /"GameType" must be a mapping, got a sequence/
    )
    expect(() => loadGameType('a: [unclosed')).toThrow(/Invalid YAML/)
  })
})
