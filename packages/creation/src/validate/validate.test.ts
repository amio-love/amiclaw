/**
 * Validator tests: the golden pair (radio-cipher GameType + rc-demo-001
 * Level) passes all four universal checks AND both hidden_info_coop floor
 * checks (overall pass + publish_ready); per check at least one injected bad
 * sample fails with a precise field_path + actionable suggestion;
 * unimplemented floor ids still surface as explicit 'skipped' results; the
 * validator never mutates its inputs.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType, loadLevel } from '../schema/load'
import type {
  CheckId,
  CheckResult,
  GameType,
  Level,
  StateEffect,
  ValidationReport,
} from '../schema/types'
import { validateGameType, validateLevel } from './validate'
import { pinyinDistance } from './verbal-distinguishability'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'radio-cipher'
)

const gameType = loadGameType(readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(fixturesDir, 'level.rc-demo-001.yaml'), 'utf8'))

function checkOf(report: ValidationReport, checkType: CheckId): CheckResult {
  const check = report.checks.find((c) => c.check_type === checkType)
  if (!check) throw new Error(`check ${checkType} missing from report`)
  return check
}

function cloneLevel(): Level {
  return structuredClone(level)
}

function cloneGameType(): GameType {
  return structuredClone(gameType)
}

describe('golden sample (rc-demo-001)', () => {
  const report = validateLevel(gameType, level)

  it('passes all four universal checks', () => {
    expect(checkOf(report, 'schema_conformance').verdict).toBe('pass')
    expect(checkOf(report, 'solvability').verdict).toBe('pass')
    expect(checkOf(report, 'fairness').verdict).toBe('pass')
    expect(checkOf(report, 'budget_compliance').verdict).toBe('pass')
    expect(report.level_id).toBe('rc-demo-001')
    expect(report.game_type_version).toBe(gameType.version)
  })

  it('executes the hidden_info_coop floor checks and they pass', () => {
    expect(report.checks).toHaveLength(6)
    const communication = checkOf(report, 'communication_completeness')
    const verbal = checkOf(report, 'verbal_distinguishability')
    expect(communication.verdict).toBe('pass')
    expect(verbal.verdict).toBe('pass')
    expect(communication.violations).toEqual([])
    expect(verbal.violations).toEqual([])
  })

  it('reaches the R3 milestone: overall pass + publish_ready with all activated checks passing', () => {
    expect(report.checks.every((check) => check.verdict === 'pass')).toBe(true)
    expect(report.overall_verdict).toBe('pass')
    expect(report.publish_ready).toBe(true)
  })

  it('still caps overall_verdict at warn while an activated floor check is unimplemented', () => {
    // A catalog entry naming a floor check with no implementation: it must
    // surface as 'skipped', cap overall at 'warn', and hold publish closed.
    const phantomCatalog = [
      {
        id: 'hidden_info_coop',
        floor_checks: ['communication_completeness', 'verbal_distinguishability', 'future_floor'],
      },
    ]
    const phantomReport = validateLevel(gameType, level, phantomCatalog)
    expect(checkOf(phantomReport, 'future_floor').verdict).toBe('skipped')
    expect(phantomReport.overall_verdict).toBe('warn')
    expect(phantomReport.publish_ready).toBe(false)
  })

  it('reaches pass + publish_ready only when every activated check literally passes', () => {
    // A catalog whose hidden_info_coop entry activates no floor checks:
    // all activated checks (the four universal) are literal 'pass'.
    const floorFreeCatalog = [{ id: 'hidden_info_coop', floor_checks: [] }]
    const floorFreeReport = validateLevel(gameType, level, floorFreeCatalog)
    expect(floorFreeReport.checks).toHaveLength(4)
    expect(floorFreeReport.overall_verdict).toBe('pass')
    expect(floorFreeReport.publish_ready).toBe(true)
  })

  it('does not mutate its inputs (read-only invariant)', () => {
    const gameTypeBefore = JSON.stringify(gameType)
    const levelBefore = JSON.stringify(level)
    validateLevel(gameType, level)
    validateGameType(gameType)
    expect(JSON.stringify(gameType)).toBe(gameTypeBefore)
    expect(JSON.stringify(level)).toBe(levelBefore)
  })

  it('passes the registration-time gametype_consistency gate', () => {
    const result = validateGameType(gameType)
    expect(result.check_type).toBe('gametype_consistency')
    expect(result.verdict).toBe('pass')
  })
})

describe('schema_conformance failures', () => {
  it('flags an enum violation with a precise field path', () => {
    const bad = cloneLevel()
    bad.elements[0].params.content_length = 'gigantic'
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'enum_membership')
    expect(violation?.field_path).toBe('elements[0].params.content_length')
    expect(violation?.expected).toContain('short')
    expect(violation?.suggestion).toContain('short')
  })

  it('flags a game_type_version mismatch (exact version binding)', () => {
    const bad = cloneLevel()
    bad.metadata.game_type_version = '9.9.9'
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const violation = check.violations.find((v) => v.constraint === 'version_binding')
    expect(violation?.field_path).toBe('metadata.game_type_version')
    expect(violation?.expected).toBe('1.0.0')
  })

  it('flags AI-authored nesting beyond the 3-level ceiling', () => {
    const bad = cloneLevel()
    bad.elements[0].params.content_length = { deep: 'structure' } as unknown as string
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const violation = check.violations.find((v) => v.constraint === 'max_nesting_depth')
    expect(violation?.field_path).toBe('elements[0].params.content_length')
    expect(violation?.suggestion).toContain('Flatten')
  })

  it('accepts a botanical-garden-style rule binding verbatim from the spec example', () => {
    // Template context mirrors the spec's botanical needs_rule; the binding
    // block below is VERBATIM from the spec's rule-fern-needs worked example.
    const extendedGameType = cloneGameType()
    extendedGameType.rule_templates.push({
      id: 'needs_rule',
      type: 'condition_action',
      condition_schema: {
        predicates: [
          {
            name: 'species_is',
            params: [{ name: 'species', type: 'string' }],
            description: 'Species equals the given value',
          },
          {
            name: 'in_zone_where',
            params: [
              { name: 'zone_attribute', type: 'string' },
              { name: 'value', type: 'string' },
            ],
            description: 'Zone attribute equals the given value',
          },
        ],
        combinators: ['AND', 'OR', 'NOT'],
      },
      action_schema: { verbs: ['change_health'] },
      communication_weight: 2.0,
    })
    extendedGameType.action_registry.push({
      name: 'change_health',
      description: 'Health state change (engine-internal effect)',
      params: [{ name: 'new_state', type: 'string' }],
      scope: 'rule_verb',
    })
    const modified = cloneLevel()
    modified.rules.push({
      id: 'rule-fern-needs',
      template: 'needs_rule',
      bindings: {
        predicates: [
          { name: 'species_is', species: 'fern' },
          { name: 'in_zone_where', zone_attribute: 'light_level', value: 'full_sun' },
        ],
        combinator: 'AND',
        action: { verb: 'change_health', new_state: 'wilting' },
      },
      target_elements: ['seg-1'],
    })
    const check = checkOf(validateLevel(extendedGameType, modified), 'schema_conformance')
    expect(check.verdict).toBe('pass')
  })

  it('rejects a predicates[] entry instantiating an undeclared predicate', () => {
    const bad = cloneLevel()
    const verify = bad.rules.find((r) => r.id === 'rule-verify')
    if (!verify) throw new Error('fixture rule missing')
    verify.bindings = { predicates: [{ name: 'is_palindrome' }] }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const violation = check.violations.find((v) => v.constraint === 'predicate_registered')
    expect(violation?.field_path).toBe('rules[2].bindings.predicates[0].name')
    expect(violation?.expected).toContain('plaintext_is_valid_word')
  })

  it('rejects a combinator outside the template-declared set', () => {
    const bad = cloneLevel()
    const verify = bad.rules.find((r) => r.id === 'rule-verify')
    if (!verify) throw new Error('fixture rule missing')
    verify.bindings = { ...verify.bindings, combinator: 'XOR' }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const violation = check.violations.find((v) => v.constraint === 'combinator_registered')
    expect(violation?.field_path).toBe('rules[2].bindings.combinator')
    expect(violation?.expected).toContain('AND')
    expect(violation?.suggestion).toContain('default')
  })

  it('rejects a non-canonical flat binding key on a condition_action rule', () => {
    const bad = cloneLevel()
    const verify = bad.rules.find((r) => r.id === 'rule-verify')
    if (!verify) throw new Error('fixture rule missing')
    verify.bindings = { category: 'animal' } // pre-canonical flat shape
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const violation = check.violations.find((v) => v.constraint === 'binding_param_defined')
    expect(violation?.field_path).toBe('rules[2].bindings.category')
    expect(violation?.expected).toBe('one of [predicates, combinator, action]')
  })

  it('rejects an over-deep free value on a declared scalar binding param', () => {
    const bad = cloneLevel()
    bad.rules[0].bindings.cipher_segment_id = { deep: { deeper: true } }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    const violation = check.violations.find((v) => v.constraint === 'max_nesting_depth')
    expect(violation?.field_path).toBe('rules[0].bindings.cipher_segment_id')
  })

  it('flags an unregistered co_play_form and appends no floor checks', () => {
    const badGameType = cloneGameType()
    badGameType.co_play_form = 'freeform_jam'
    const report = validateLevel(badGameType, level)
    const violation = checkOf(report, 'schema_conformance').violations.find(
      (v) => v.constraint === 'co_play_form_registered'
    )
    expect(violation?.field_path).toBe('game_type.co_play_form')
    expect(report.checks).toHaveLength(4)
    expect(report.overall_verdict).toBe('fail')
  })
})

describe('solvability failures', () => {
  it('flags an uncovered win-condition target element', () => {
    const bad = cloneLevel()
    // Retarget the reverse rule at seg-1: seg-2 keeps no rule while every
    // other check's inputs stay untouched.
    const reverseRule = bad.rules.find((r) => r.id === 'rule-reverse-2')
    if (!reverseRule) throw new Error('fixture rule missing')
    reverseRule.target_elements = ['seg-1']
    reverseRule.bindings.cipher_segment_id = 'seg-1'
    const report = validateLevel(gameType, bad)
    const check = checkOf(report, 'solvability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'solution_path_exists')
    expect(violation?.field_path).toBe('win_condition.params.target_elements[1]')
    expect(violation?.actual).toContain('seg-2')
    expect(violation?.suggestion).toContain('seg-2')
    // isolation: the other universal checks still pass
    expect(checkOf(report, 'schema_conformance').verdict).toBe('pass')
    expect(checkOf(report, 'budget_compliance').verdict).toBe('pass')
  })

  it('flags an unregistered solver strategy', () => {
    const badGameType = cloneGameType()
    badGameType.solver_strategy = 'quantum_annealing'
    const check = checkOf(validateLevel(badGameType, level), 'solvability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'solver_strategy_registered')
    expect(violation?.field_path).toBe('game_type.solver_strategy')
    expect(violation?.actual).toBe('quantum_annealing')
  })

  it('reports a timeout when the bound is exhausted', () => {
    const badGameType = cloneGameType()
    badGameType.solver_timeout_ms = 0
    const check = checkOf(validateLevel(badGameType, level), 'solvability')
    expect(check.verdict).toBe('fail')
    const violations = check.violations.filter((v) => v.constraint === 'solver_timeout')
    expect(violations).toHaveLength(1)
    expect(violations[0].field_path).toBe('game_type.solver_timeout_ms')
  })
})

describe('fairness failures', () => {
  it('flags solution-relevant information no role can observe', () => {
    const bad = cloneLevel()
    const decoder = bad.information_partition.role_assignments.find((a) => a.role === 'decoder')
    if (!decoder) throw new Error('fixture role missing')
    decoder.element_views = decoder.element_views.filter((view) => view.element_id !== 'key-1')
    const report = validateLevel(gameType, bad)
    const check = checkOf(report, 'fairness')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find(
      (v) => v.constraint === 'solution_information_observable'
    )
    expect(violation?.field_path).toBe('elements[2]') // key-1
    expect(violation?.actual).toContain('shift_amount')
    expect(violation?.actual).toContain('50') // 2 methods x 25 shift values
    expect(violation?.suggestion).toContain('key-1')
    expect(violation?.related_elements).toEqual(['key-1'])
    // isolation: schema and budget do not consult level-side views
    expect(checkOf(report, 'schema_conformance').verdict).toBe('pass')
    expect(checkOf(report, 'budget_compliance').verdict).toBe('pass')
  })

  it('ignores hidden params no referencing rule consumes (cosmetic information)', () => {
    const modified = cloneLevel()
    // Reference hint-2 as a target of the verify rule and hide it entirely:
    // its params (hint_type / target_syllable) never appear among the rule's
    // binding values, so hiding them costs no fairness violation.
    const verify = modified.rules.find((r) => r.id === 'rule-verify')
    if (!verify) throw new Error('fixture rule missing')
    verify.target_elements = [...verify.target_elements, 'hint-2']
    const decoder = modified.information_partition.role_assignments.find(
      (a) => a.role === 'decoder'
    )
    if (!decoder) throw new Error('fixture role missing')
    decoder.element_views = decoder.element_views.filter((view) => view.element_id !== 'hint-2')
    const report = validateLevel(gameType, modified)
    expect(checkOf(report, 'fairness').verdict).toBe('pass')
  })
})

describe('budget_compliance failures', () => {
  it('flags a shared-label instance collision with the spec suggestion', () => {
    const bad = cloneLevel()
    bad.elements[1].params.content_length = 'short' // collides with seg-1
    const report = validateLevel(gameType, bad)
    const check = checkOf(report, 'budget_compliance')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'instance_label_unique')
    expect(violation?.field_path).toBe('elements[1].params.content_length')
    expect(violation?.related_elements).toEqual(['seg-1', 'seg-2'])
    expect(violation?.suggestion).toContain('disambiguating attribute')
    // isolation: 'short' is a legal enum value, so schema still passes
    expect(checkOf(report, 'schema_conformance').verdict).toBe('pass')
    expect(checkOf(report, 'fairness').verdict).toBe('pass')
    expect(checkOf(report, 'solvability').verdict).toBe('pass')
  })

  it('flags declared counts that diverge from the actual level content', () => {
    const bad = cloneLevel()
    bad.difficulty.element_count = 7
    const check = checkOf(validateLevel(gameType, bad), 'budget_compliance')
    const violation = check.violations.find(
      (v) =>
        v.field_path === 'difficulty.element_count' && v.constraint === 'declared_matches_actual'
    )
    expect(violation?.expected).toBe('5')
    expect(violation?.actual).toBe('7')
  })

  it('flags a stale communication estimate', () => {
    const bad = cloneLevel()
    bad.communication_estimate.round_trips = 9
    const check = checkOf(validateLevel(gameType, bad), 'budget_compliance')
    const violation = check.violations.find(
      (v) =>
        v.field_path === 'communication_estimate.round_trips' &&
        v.constraint === 'declared_matches_actual'
    )
    expect(violation?.expected).toContain('5')
    expect(violation?.suggestion).toContain('communication_weight')
  })

  it('flags a Level time limit diverging from the GameType communication budget', () => {
    const bad = cloneLevel()
    bad.communication_estimate.time_limit_seconds = 600 // inflated — cannot buy feasibility
    const check = checkOf(validateLevel(gameType, bad), 'budget_compliance')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find(
      (v) => v.field_path === 'communication_estimate.time_limit_seconds'
    )
    expect(violation?.expected).toBe('300')
    expect(violation?.actual).toBe('600')
    expect(violation?.suggestion).toContain('communication_budget')
  })
})

describe('gametype_consistency failures (registration gate)', () => {
  it('flags an action_capability referencing an unregistered action', () => {
    const badGameType = cloneGameType()
    const template = badGameType.information_partition_template
    if (!template) throw new Error('fixture partition template missing')
    template.action_capability[0].can_perform.push('fly')
    const result = validateGameType(badGameType)
    expect(result.verdict).toBe('fail')
    const violation = result.violations.find((v) => v.constraint === 'action_registered')
    expect(violation?.field_path).toBe(
      'game_type.information_partition_template.action_capability[0].can_perform[2]'
    )
    expect(violation?.suggestion).toContain('action_registry')
  })

  it('flags a shared-label attribute invisible to a communicating role', () => {
    const badGameType = cloneGameType()
    const template = badGameType.information_partition_template
    if (!template) throw new Error('fixture partition template missing')
    // Declare plaintext_category as a shared label source — the listener
    // cannot see it, so cross-role co-reference would break.
    template.shared_label_attributes[0].attributes.push('plaintext_category')
    const result = validateGameType(badGameType)
    expect(result.verdict).toBe('fail')
    const violation = result.violations.find((v) => v.constraint === 'shared_label_visible_to_all')
    expect(violation?.actual).toContain('listener')
    expect(violation?.suggestion).toContain('can_see')
  })

  it('flags an undeclared state_effect value (G6 enum guard)', () => {
    const badGameType = cloneGameType()
    badGameType.action_registry[0].state_effect = 'advnce_state' as StateEffect
    const result = validateGameType(badGameType)
    expect(result.verdict).toBe('fail')
    const violation = result.violations.find((v) => v.constraint === 'state_effect_registered')
    expect(violation?.field_path).toBe('game_type.action_registry[0].state_effect')
    expect(violation?.expected).toContain('advance_state')
  })
})

describe('communication_completeness failures', () => {
  it('passes when a decoder-only field has no reverse channel (per-consuming-role model)', () => {
    // key-1's fields are decoder-consumed (the decoder holds the rules per
    // rule_visibility) and decoder-visible: the listener receives derived
    // instructions, never the raw fields. Removing the decoder→listener
    // channel therefore must NOT produce a coverage violation.
    const badGameType = cloneGameType()
    const template = badGameType.information_partition_template
    if (!template) throw new Error('fixture partition template missing')
    template.communication_channels = template.communication_channels.filter(
      (channel) => !(channel.from === 'decoder' && channel.to === 'listener')
    )
    const check = checkOf(validateLevel(badGameType, level), 'communication_completeness')
    expect(check.verdict).toBe('pass')
  })

  it('flags a consumed field its consuming role can neither see nor receive', () => {
    // Move seg-1's plaintext_category from the decoder (its consuming role)
    // to the listener, and drop the listener→decoder channel: the consumer
    // can neither observe the field nor receive it. fairness still passes —
    // the listener observes the field, so it is not a guess.
    const badGameType = cloneGameType()
    const template = badGameType.information_partition_template
    if (!template) throw new Error('fixture partition template missing')
    template.communication_channels = template.communication_channels.filter(
      (channel) => !(channel.from === 'listener' && channel.to === 'decoder')
    )
    const bad = cloneLevel()
    const roles = bad.information_partition.role_assignments
    const listenerView = roles
      .find((a) => a.role === 'listener')
      ?.element_views.find((view) => view.element_id === 'seg-1')
    const decoderView = roles
      .find((a) => a.role === 'decoder')
      ?.element_views.find((view) => view.element_id === 'seg-1')
    if (!listenerView || !decoderView) throw new Error('fixture views missing')
    listenerView.visible_attributes = [...listenerView.visible_attributes, 'plaintext_category']
    decoderView.visible_attributes = decoderView.visible_attributes.filter(
      (attr) => attr !== 'plaintext_category'
    )
    const report = validateLevel(badGameType, bad)
    const check = checkOf(report, 'communication_completeness')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find(
      (v) =>
        v.constraint === 'communication_coverage' && v.field_path.includes('plaintext_category')
    )
    expect(violation?.field_path).toBe('elements[0].params.plaintext_category')
    expect(violation?.expected).toContain('decoder')
    expect(violation?.actual).toContain('listener')
    expect(checkOf(report, 'fairness').verdict).toBe('pass')
  })

  it('flags merged information admitting two solutions for one target', () => {
    const bad = cloneLevel()
    // A second executable advancing pipeline on seg-1: caesar decryption AND
    // reverse decryption both fit the merged information.
    bad.rules.push({
      id: 'rule-reverse-1b',
      template: 'reverse_decrypt',
      bindings: { cipher_segment_id: 'seg-1' },
      target_elements: ['seg-1'],
    })
    const check = checkOf(validateLevel(gameType, bad), 'communication_completeness')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'solution_unique')
    expect(violation?.field_path).toBe('win_condition.params.target_elements[0]')
    expect(violation?.actual).toContain('rule-decrypt-1')
    expect(violation?.actual).toContain('rule-reverse-1b')
    expect(violation?.suggestion).toContain('single solution')
  })

  it('rejects partitions outside the two-role scope and still checks surface versions', () => {
    const bad = cloneLevel()
    bad.information_partition.role_assignments.push({ role: 'observer', element_views: [] })
    bad.communication_surfaces = [
      {
        role: 'listener',
        game_type: 'radio-cipher',
        game_type_version: '0.9.0',
        surface_type: 'audio_cue_list',
        content: {
          elements_visible: [],
          rules_visible: [],
          action_vocabulary: [],
          communication_protocol: { partner_role: 'decoder', suggested_workflow: [] },
        },
      },
    ]
    const check = checkOf(validateLevel(gameType, bad), 'communication_completeness')
    expect(check.verdict).toBe('fail')
    const scopeViolation = check.violations.find((v) => v.constraint === 'two_role_scope')
    expect(scopeViolation?.field_path).toBe('information_partition.role_assignments')
    expect(scopeViolation?.actual).toContain('3')
    // Both defects surface in one pass: version binding is not short-circuited.
    const versionViolation = check.violations.find((v) => v.constraint === 'version_binding')
    expect(versionViolation?.field_path).toBe('communication_surfaces[0].game_type_version')
  })

  it('reports a timeout from the uniqueness sub-check instead of fake-passing', () => {
    const badGameType = cloneGameType()
    badGameType.solver_timeout_ms = 0
    const check = checkOf(validateLevel(badGameType, level), 'communication_completeness')
    expect(check.verdict).toBe('fail')
    const violations = check.violations.filter((v) => v.constraint === 'solver_timeout')
    expect(violations).toHaveLength(1)
    expect(violations[0].field_path).toBe('game_type.solver_timeout_ms')
  })

  it('flags a communication surface bound to a stale game-type version', () => {
    const bad = cloneLevel()
    bad.communication_surfaces = [
      {
        role: 'listener',
        game_type: 'radio-cipher',
        game_type_version: '0.9.0',
        surface_type: 'audio_cue_list',
        content: {
          elements_visible: [],
          rules_visible: [],
          action_vocabulary: [],
          communication_protocol: { partner_role: 'decoder', suggested_workflow: [] },
        },
      },
    ]
    const check = checkOf(validateLevel(gameType, bad), 'communication_completeness')
    const violation = check.violations.find((v) => v.constraint === 'version_binding')
    expect(violation?.field_path).toBe('communication_surfaces[0].game_type_version')
    expect(violation?.expected).toBe('1.0.0')
  })
})

describe('verbal_distinguishability', () => {
  it('measures syllable+tone edit distance with tone differences extra-weighted', () => {
    expect(pinyinDistance('mì yào', 'mì yào')).toBe(0)
    expect(pinyinDistance('mì yào', 'mì yáo')).toBeCloseTo(0.4) // tone-only: near-homophone
    expect(pinyinDistance('mì wén duàn', 'mì yào')).toBe(2) // one substitution + one deletion
    expect(pinyinDistance('mì yào', 'pín lǜ tí shì')).toBe(4)
  })

  it('normalizes numeric-tone pinyin to the tone-marked form', () => {
    expect(pinyinDistance('mi4 yao4', 'mì yào')).toBe(0)
    expect(pinyinDistance('lv4', 'lǜ')).toBe(0)
    expect(pinyinDistance('mi4 yao2', 'mì yào')).toBeCloseTo(0.4) // numeric tone still scores
  })

  it('warns on near-homophone archetype labels (archetype layer)', () => {
    const badGameType = cloneGameType()
    // 密药 (mì yào) collides with 密钥 (mì yào) at distance 0.
    badGameType.element_archetypes[2].verbal_label = {
      canonical: '密药',
      phonetic_pinyin: 'mì yào',
      aliases: [],
      forbidden_terms: [],
    }
    const report = validateLevel(badGameType, level)
    const check = checkOf(report, 'verbal_distinguishability')
    expect(check.verdict).toBe('warn')
    const violation = check.violations.find((v) => v.constraint === 'verbal_distance_threshold')
    expect(violation?.severity).toBe('warning')
    expect(violation?.field_path).toBe(
      'game_type.element_archetypes[2].verbal_label.phonetic_pinyin'
    )
    expect(violation?.actual).toContain('密药')
    // A warn-level floor check keeps overall at warn and publish closed.
    expect(report.overall_verdict).toBe('warn')
    expect(report.publish_ready).toBe(false)
  })

  it('errors on colliding rendered instance labels (instance layer)', () => {
    const bad = cloneLevel()
    bad.elements[1].params.content_length = 'short' // both segments render 短密文段
    const check = checkOf(validateLevel(gameType, bad), 'verbal_distinguishability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'rendered_label_unique')
    expect(violation?.field_path).toBe('elements[1]')
    expect(violation?.actual).toContain('短密文段')
    expect(violation?.related_elements).toEqual(['seg-1', 'seg-2'])
  })

  it('catches distinct raw values whose display labels collide — and only at the rendered layer', () => {
    // Two DISTINCT raw values (short / medium) both display as 短: the raw
    // combos stay unique (budget_compliance silent) while the rendered
    // labels collide (verbal_distinguishability fires) — the layers are
    // complementary, not redundant.
    const badGameType = cloneGameType()
    const contentLength = badGameType.element_archetypes[0].attributes.find(
      (attr) => attr.name === 'content_length'
    )
    if (!contentLength) throw new Error('fixture attribute missing')
    contentLength.display_labels = { short: '短', medium: '短', long: '长' }
    const report = validateLevel(badGameType, level)
    const verbal = checkOf(report, 'verbal_distinguishability')
    expect(verbal.verdict).toBe('fail')
    const rendered = verbal.violations.find((v) => v.constraint === 'rendered_label_unique')
    expect(rendered?.actual).toContain('短密文段')
    expect(rendered?.related_elements).toEqual(['seg-1', 'seg-2'])
    const budget = checkOf(report, 'budget_compliance')
    expect(budget.violations.find((v) => v.constraint === 'instance_label_unique')).toBeUndefined()
    expect(budget.verdict).toBe('pass')
  })
})

describe('violation contract', () => {
  it('every emitted violation carries field_path and suggestion (spec invariant)', () => {
    const bad = cloneLevel()
    bad.elements[0].params.content_length = 'gigantic'
    bad.metadata.game_type_version = '9.9.9'
    bad.difficulty.element_count = 7
    const reverseRule = bad.rules.find((r) => r.id === 'rule-reverse-2')
    if (!reverseRule) throw new Error('fixture rule missing')
    reverseRule.target_elements = ['seg-1']
    const report = validateLevel(gameType, bad)
    const allViolations = report.checks.flatMap((check) => check.violations)
    expect(allViolations.length).toBeGreaterThan(0)
    for (const violation of allViolations) {
      expect(violation.field_path.length).toBeGreaterThan(0)
      expect(violation.suggestion.length).toBeGreaterThan(0)
    }
  })
})
