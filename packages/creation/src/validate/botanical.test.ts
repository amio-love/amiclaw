/**
 * Botanical Garden validator tests: the third case game, hidden_info_coop
 * (same form as radio-cipher, floors REUSED). Golden gate: all universal
 * checks + BOTH hidden_info floors pass (overall 'pass' + publish_ready);
 * the report contains ONLY hidden_info's floors (never co_build's). csp
 * solver strategy registered + optimization_target executed. Bad samples
 * for csp registration, optimization_target params, and unsolvable care.
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
  'botanical-garden'
)
const gameType = loadGameType(readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8'))
const level = loadLevel(readFileSync(join(fixturesDir, 'level.bg-demo-001.yaml'), 'utf8'))

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

describe('botanical golden gate (bg-demo-001)', () => {
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

  it('activates the hidden_info_coop floors (reused) — never co_build’s', () => {
    const checkTypes = report.checks.map((check) => check.check_type)
    expect(checkTypes).toContain('communication_completeness')
    expect(checkTypes).toContain('verbal_distinguishability')
    expect(checkTypes).not.toContain('goal_reachability')
    expect(checkTypes).not.toContain('progress_measurability')
    expect(report.checks).toHaveLength(6)
  })

  it('verbal_distinguishability passes on the larger vocabulary', () => {
    // 植株 (zhí zhū) vs 环境区 (huán jìng qū) are far apart; species instance
    // labels (蕨类植株 …) are all distinct rendered strings.
    expect(checkOf(report, 'verbal_distinguishability').verdict).toBe('pass')
  })

  it('passes the registration-time gametype_consistency gate', () => {
    expect(validateGameType(gameType).verdict).toBe('pass')
  })
})

describe('F2 solver rule-move capability gate (solver reachability ⊆ engine reachability)', () => {
  it('a mis-scoped level where no role can act on the rule-targeted archetype fails solvability', () => {
    // Scope BOTH roles' target_archetypes to environment_zone → no role can
    // act on plant, so the care rules (all plant-targeting) can never fire in
    // the live engine. Pre-fix this published clean (false positive).
    const badGameType = cloneGameType()
    const template = badGameType.information_partition_template
    if (!template) throw new Error('fixture partition template missing')
    for (const capability of template.action_capability) {
      capability.target_archetypes = ['environment_zone']
    }

    // Solver: rule moves on plants are pruned → win unreachable → fail.
    expect(searchSolution(badGameType, level).solvable).toBe(false)
    const report = validateLevel(badGameType, level)
    expect(checkOf(report, 'solvability').verdict).toBe('fail')
    expect(report.publish_ready).toBe(false)

    // Engine mirror: the live engine rejects every winning move.
    const session = new GameSession(badGameType, level)
    const attempt = session.performAction('gardener', 'apply_care', {
      element_id: 'plant-1',
      action_type: 'water',
    })
    expect(attempt.ok).toBe(false)
    expect(!attempt.ok && attempt.reason).toContain('plant')
  })
})

describe('csp solver strategy', () => {
  it('is registered: the csp GameType runs a real search, not a strategy rejection', () => {
    expect(gameType.solver_strategy).toBe('csp')
    const check = checkOf(validateLevel(gameType, level), 'solvability')
    expect(check.verdict).toBe('pass')
    expect(check.violations.some((v) => v.constraint === 'solver_strategy_registered')).toBe(false)
  })

  it('still rejects an unregistered strategy', () => {
    const badGameType = cloneGameType()
    badGameType.solver_strategy = 'quantum_annealing'
    const check = checkOf(validateLevel(badGameType, level), 'solvability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'solver_strategy_registered')
    expect(violation?.expected).toContain('csp')
  })

  it('reports a timeout instead of fake-passing under a zero bound', () => {
    const badGameType = cloneGameType()
    badGameType.solver_timeout_ms = 0
    const check = checkOf(validateLevel(badGameType, level), 'solvability')
    expect(check.verdict).toBe('fail')
    expect(check.violations.some((v) => v.constraint === 'solver_timeout')).toBe(true)
  })
})

describe('schema_conformance validates per-instance initial_states', () => {
  it('flags an initial_states key that names no declared state', () => {
    const bad = cloneLevel()
    const plant = bad.elements.find((e) => e.id === 'plant-1')
    if (!plant) throw new Error('fixture element missing')
    plant.initial_states = { ...plant.initial_states, vigor: 'high' }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find((v) => v.constraint === 'state_defined')
    expect(violation?.field_path).toBe('elements[0].initial_states.vigor')
    expect(violation?.expected).toContain('health')
    expect(violation?.suggestion).toContain('plant')
  })

  it('flags an initial_states value outside the state’s declared enum', () => {
    const bad = cloneLevel()
    const plant = bad.elements.find((e) => e.id === 'plant-1')
    if (!plant) throw new Error('fixture element missing')
    plant.initial_states = { ...plant.initial_states, health: 'radiant' }
    const check = checkOf(validateLevel(gameType, bad), 'schema_conformance')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find(
      (v) =>
        v.constraint === 'enum_membership' && v.field_path === 'elements[0].initial_states.health'
    )
    expect(violation?.expected).toContain('stable')
    expect(violation?.actual).toBe('radiant')
  })
})

describe('optimization_target solvability', () => {
  it('fails an undeclared state in a constraint', () => {
    const bad = cloneLevel()
    ;(bad.win_condition.params.all_states_at_least as { state: string }[])[0].state = 'vitality'
    const check = checkOf(validateLevel(gameType, bad), 'solvability')
    expect(check.verdict).toBe('fail')
    const violation = check.violations.find(
      (v) => v.constraint === 'state_declared' && v.field_path.includes('all_states_at_least')
    )
    expect(violation?.actual).toBe('vitality')
  })

  it('fails an unsatisfiable care goal (flowering structurally unreachable)', () => {
    // Drop the growth rule so no care sequence reaches flowering; the search
    // exhausts the small remaining space fast and deterministically.
    const bad = cloneLevel()
    bad.rules = bad.rules.filter((r) => r.id !== 'rule-growth')
    const check = checkOf(validateLevel(gameType, bad), 'solvability')
    expect(check.verdict).toBe('fail')
    expect(check.violations.some((v) => v.constraint === 'solution_path_exists')).toBe(true)
  })

  it('fails when no optimization constraints are declared', () => {
    const bad = cloneLevel()
    bad.win_condition.params = {}
    const check = checkOf(validateLevel(gameType, bad), 'solvability')
    expect(check.verdict).toBe('fail')
    expect(check.violations.some((v) => v.constraint === 'optimization_constraints_declared')).toBe(
      true
    )
  })
})
