/**
 * Sound Garden validator tests: the second co-play form flowing through the
 * catalog-enumerated floor mechanism. Golden gate: all universal checks +
 * BOTH co_build floors literally pass (overall 'pass' + publish_ready), and
 * the report contains ONLY co_build's floors — the hidden_info pair must
 * not activate. Bad samples per floor check.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GameSession } from '../engine/engine'
import { searchSolution } from '../engine/search'
import { loadGameType, loadLevel } from '../schema/load'
import type { CheckId, CheckResult, GameType, Level, ValidationReport } from '../schema/types'
import { validateGameType, validateLevel } from './validate'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'sound-garden'
)
const gameType = loadGameType(readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(fixturesDir, 'level.sg-demo-001.yaml'), 'utf8'))

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

describe('sound-garden golden gate (sg-demo-001)', () => {
  const report = validateLevel(gameType, level)

  it('reaches overall pass + publish_ready with every activated check passing', () => {
    for (const check of report.checks) {
      expect(`${String(check.check_type)}:${check.verdict}`).toBe(
        `${String(check.check_type)}:pass`
      )
    }
    expect(report.overall_verdict).toBe('pass')
    expect(report.publish_ready).toBe(true)
  })

  it('activates ONLY the co_build floors — never the hidden_info pair', () => {
    const checkTypes = report.checks.map((check) => check.check_type)
    expect(checkTypes).toContain('goal_reachability')
    expect(checkTypes).toContain('progress_measurability')
    expect(checkTypes).toContain('construction_visibility')
    expect(checkTypes).not.toContain('communication_completeness')
    expect(checkTypes).not.toContain('verbal_distinguishability')
    expect(report.checks).toHaveLength(7)
  })

  it('passes the registration-time gametype_consistency gate', () => {
    expect(validateGameType(gameType).verdict).toBe('pass')
  })
})

describe('goal_reachability failures', () => {
  it('flags a target beyond the best achievable build', () => {
    const bad = cloneLevel()
    bad.win_condition.params.target_score = 99
    const check = checkOf(validateLevel(gameType, bad), 'goal_reachability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'goal_reachable')
    expect(violation?.field_path).toBe('win_condition.params.target_score')
    expect(violation?.expected).toContain('12') // max_possible_score per the spec worked example
    expect(violation?.suggestion).toContain('target_score')
  })

  it('warns when even the worst assignment reaches the target (trivial goal)', () => {
    const bad = cloneLevel()
    bad.win_condition.params.target_score = 1 // min_possible_score is 2
    const report = validateLevel(gameType, bad)
    const check = checkOf(report, 'goal_reachability')
    expect(check.verdict).toBe('warn')
    const violation = check.violations.find((v) => v.constraint === 'goal_non_trivial')
    expect(violation?.severity).toBe('warning')
    expect(violation?.actual).toContain('2')
    expect(report.publish_ready).toBe(false)
  })

  it('flags a missing material-pool declaration', () => {
    const bad = cloneLevel()
    delete bad.available_materials
    const check = checkOf(validateLevel(gameType, bad), 'goal_reachability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'material_pools_declared')
    expect(violation?.field_path).toBe('available_materials')
  })

  it('flags an oversized material pool (bounded assignment analysis)', () => {
    const bad = cloneLevel()
    if (!bad.available_materials) throw new Error('fixture materials missing')
    bad.available_materials.rhythm_builder[0].count = 9 // 9 + 3 = 12 > 8
    const check = checkOf(validateLevel(gameType, bad), 'goal_reachability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'material_pool_bounded')
    expect(violation?.field_path).toBe('available_materials')
    expect(violation?.actual).toContain('12')
  })

  it('flags a third material pool (co_build two-pool scope)', () => {
    const bad = cloneLevel()
    if (!bad.available_materials) throw new Error('fixture materials missing')
    bad.available_materials.observer = []
    const check = checkOf(validateLevel(gameType, bad), 'goal_reachability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'material_pools_declared')
    expect(violation?.actual).toContain('3')
  })

  it('flags a stripped scoring source (relation_scores removed)', () => {
    const badGameType = cloneGameType()
    const template = badGameType.rule_templates[0]
    if (template.type !== 'interaction_matrix') throw new Error('fixture template kind')
    delete template.matrix_schema.relation_scores
    const report = validateLevel(badGameType, level)
    expect(
      checkOf(report, 'goal_reachability').violations.some(
        (v) => v.constraint === 'score_source_declared'
      )
    ).toBe(true)
    expect(
      checkOf(report, 'progress_measurability').violations.some(
        (v) => v.constraint === 'score_source_declared'
      )
    ).toBe(true)
  })
})

describe('progress_measurability failures', () => {
  it('flags a non-positive target score (progress denominator)', () => {
    const bad = cloneLevel()
    bad.win_condition.params.target_score = 0
    const check = checkOf(validateLevel(gameType, bad), 'progress_measurability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'progress_computable')
    expect(violation?.field_path).toBe('win_condition.params.target_score')
  })

  it('flags a missing construction slot model', () => {
    const bad = cloneLevel()
    delete bad.initial_state
    const check = checkOf(validateLevel(gameType, bad), 'progress_measurability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'construction_model_declared')
    expect(violation?.field_path).toBe('initial_state')
  })

  it('flags a designed configuration that cannot reach the target (matrix rows omitted)', () => {
    const bad = cloneLevel()
    bad.rules[0].bindings.matrix = [] // no scoring rows — designed build scores 0
    const check = checkOf(validateLevel(gameType, bad), 'progress_measurability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'designed_goal_score')
    expect(violation?.actual).toContain('0')
    expect(violation?.expected).toContain('10')
  })
})

describe('construction_visibility failures (F5 co_build floor)', () => {
  it('passes when both builders see the whole construction space (golden)', () => {
    const check = checkOf(validateLevel(gameType, level), 'construction_visibility')
    expect(check.verdict).toBe('pass')
    expect(check.violations).toEqual([])
  })

  it('fails a blind builder whose element_views are emptied → publish closed', () => {
    const bad = cloneLevel()
    const melody = bad.information_partition.role_assignments.find(
      (assignment) => assignment.role === 'melody_builder'
    )
    if (!melody) throw new Error('fixture role missing')
    melody.element_views = [] // the melody builder can see nothing of the shared timeline
    const report = validateLevel(gameType, bad)
    const check = checkOf(report, 'construction_visibility')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find(
      (v) => v.constraint === 'builder_sees_construction_space'
    )
    expect(violation?.actual).toContain('melody_builder')
    expect(violation?.actual).toContain('rhythm_piece') // missing coverage names the archetypes
    expect(violation?.actual).toContain('melody_piece')
    expect(report.publish_ready).toBe(false)
  })

  it('fails a builder that sees only its own pieces (misses the partner archetype)', () => {
    const bad = cloneLevel()
    const rhythm = bad.information_partition.role_assignments.find(
      (assignment) => assignment.role === 'rhythm_builder'
    )
    if (!rhythm) throw new Error('fixture role missing')
    // Rhythm builder keeps only rhythm pieces: it cannot observe the melody
    // half of the shared construction space it must coordinate with.
    rhythm.element_views = rhythm.element_views.filter((view) => view.element_id.startsWith('r'))
    const check = checkOf(validateLevel(gameType, bad), 'construction_visibility')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find(
      (v) => v.constraint === 'builder_sees_construction_space'
    )
    expect(violation?.actual).toContain('missing [melody_piece]')
  })
})

describe('solver-engine lockstep on construction (M2)', () => {
  it('a level whose melody pieces no role can place fails solvability AND is engine-unplayable', () => {
    const badGameType = cloneGameType()
    const template = badGameType.information_partition_template
    if (!template) throw new Error('fixture partition template missing')
    // melody_builder may now only target rhythm pieces: melody pieces
    // become unplaceable by everyone.
    const melodyCapability = template.action_capability.find(
      (entry) => entry.role === 'melody_builder'
    )
    if (!melodyCapability) throw new Error('fixture capability missing')
    melodyCapability.target_archetypes = ['rhythm_piece']

    // Engine cannot play it…
    const session = new GameSession(badGameType, level)
    expect(session.performAction('melody_builder', 'place_piece', { element_id: 'm1' }).ok).toBe(
      false
    )
    // …and the solver agrees through the per-archetype capability gate.
    expect(searchSolution(badGameType, level).solvable).toBe(false)
    const check = checkOf(validateLevel(badGameType, level), 'solvability')
    expect(check.verdict).toBe('fail')
    expect(check.violations.some((v) => v.constraint === 'solution_path_exists')).toBe(true)
  })
})
