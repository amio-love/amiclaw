/**
 * goal_reachability — co_build floor check (spec interface:
 * `(level, role_capabilities) → {reachable, blocking_resource?}`, machine
 * derivation per the sound-garden worked example): from
 * Level.initial_state + available_materials + the scoring matrix
 * (matrix rows × relation_scores) + win_condition.target_score, compute the
 * best and worst achievable total over assignments of one role's materials
 * to the other's, and require max_possible_score >= target_score.
 *
 * Also emits the spec's non-triviality signal: when even the WORST
 * assignment reaches the target (min_possible_score >= target), the goal
 * needs no coordination — a warning, not an error.
 *
 * Deadline policy (H3): ONE deadline per check invocation; the assignment
 * enumeration (n! for n <= 8 materials per pool) is bounded by it.
 *
 * NOTE (M5): this is a cheap NECESSARY-condition floor — it optimizes over
 * a free bijective assignment of materials and ignores fixed timeline slots
 * and placement order, so it over-approximates what a real build can do.
 * solvability's engine search is the authoritative reachability gate; this
 * floor exists for fast, field-precise diagnostics.
 */

import type { GameType, Level, CheckResult, Violation, RuleTemplate } from '../schema/types'
import { buildCheckResult, startDeadline, templatesById } from './helpers'

const MAX_POOL_SIZE = 8

interface ScoringModel {
  rows: [string, string, string][]
  scores: Record<string, number>
}

/** The level's matrix scoring model (rows from the rule instance, scores from the template). */
export function scoringModel(gameType: GameType, level: Level): ScoringModel | undefined {
  const templates = templatesById(gameType)
  for (const rule of level.rules) {
    const template = templates.get(rule.template)
    if (!template || template.type !== 'interaction_matrix') continue
    const scores = template.matrix_schema.relation_scores
    if (!scores) continue
    const rows = (Array.isArray(rule.bindings.matrix) ? rule.bindings.matrix : []).filter(
      (row): row is [string, string, string] => Array.isArray(row) && row.length === 3
    )
    return { rows, scores }
  }
  return undefined
}

function pairScore(model: ScoringModel, a: string, b: string): number {
  const row = model.rows.find((r) => (r[0] === a && r[1] === b) || (r[0] === b && r[1] === a))
  return row ? (model.scores[row[2]] ?? 0) : 0
}

/** Entity types in a material pool, expanded by count. */
function expandPool(
  pool: { archetype: string; count: number; [key: string]: unknown }[],
  typeAttributes: string[]
): string[] {
  const types: string[] = []
  for (const entry of pool) {
    const type = typeAttributes
      .map((attribute) => entry[attribute])
      .find((value): value is string => typeof value === 'string')
    if (!type) continue
    for (let i = 0; i < entry.count; i++) types.push(type)
  }
  return types
}

export function checkGoalReachability(gameType: GameType, level: Level): CheckResult {
  const violations: Violation[] = []
  const deadline = startDeadline(gameType.solver_timeout_ms)

  const target = level.win_condition.params.target_score
  if (typeof target !== 'number') {
    violations.push({
      severity: 'error',
      field_path: 'win_condition.params.target_score',
      constraint: 'target_score_declared',
      expected: 'a numeric target score',
      actual: JSON.stringify(target),
      suggestion: 'Declare the score threshold the build must reach',
    })
  }
  if (!level.initial_state) {
    violations.push(constructionModelViolation('initial_state'))
  }
  const materials = level.available_materials
  if (!materials || Object.keys(materials).length !== 2) {
    violations.push({
      severity: 'error',
      field_path: 'available_materials',
      constraint: 'material_pools_declared',
      expected: 'exactly two role material pools (co_build)',
      actual: materials ? `${Object.keys(materials).length} pool(s)` : 'missing',
      suggestion: 'Declare available_materials with one pool per building role',
    })
  }
  const model = scoringModel(gameType, level)
  const matrixTemplateIndex = gameType.rule_templates.findIndex(
    (template): template is Extract<RuleTemplate, { type: 'interaction_matrix' }> =>
      template.type === 'interaction_matrix'
  )
  if (!model) {
    violations.push({
      severity: 'error',
      field_path:
        matrixTemplateIndex >= 0
          ? `game_type.rule_templates[${matrixTemplateIndex}].matrix_schema.relation_scores`
          : 'game_type.rule_templates',
      constraint: 'score_source_declared',
      expected: 'an interaction_matrix rule with matrix_schema.relation_scores',
      actual: 'no scoring source found',
      suggestion:
        'Declare relation_scores on the matrix template and bind a matrix rule in the level',
    })
  }
  if (violations.length > 0 || !model || !materials || typeof target !== 'number') {
    return buildCheckResult('goal_reachability', violations)
  }

  const typeAttributes =
    matrixTemplateIndex >= 0
      ? ((
          gameType.rule_templates[matrixTemplateIndex] as Extract<
            RuleTemplate,
            { type: 'interaction_matrix' }
          >
        ).matrix_schema.entity_type_attributes ?? [])
      : []
  const [poolA, poolB] = Object.values(materials).map((pool) => expandPool(pool, typeAttributes))
  if (poolA.length > MAX_POOL_SIZE || poolB.length > MAX_POOL_SIZE) {
    violations.push({
      severity: 'error',
      field_path: 'available_materials',
      constraint: 'material_pool_bounded',
      expected: `at most ${MAX_POOL_SIZE} materials per pool for exhaustive assignment analysis`,
      actual: `${poolA.length} × ${poolB.length}`,
      suggestion: 'Reduce the material pools or extend the reachability analysis strategy',
    })
    return buildCheckResult('goal_reachability', violations)
  }

  const { best, worst, timedOut } = assignmentExtremes(model, poolA, poolB, deadline)
  if (timedOut) {
    violations.push(deadline.violation())
    return buildCheckResult('goal_reachability', violations)
  }

  if (best < target) {
    violations.push({
      severity: 'error',
      field_path: 'win_condition.params.target_score',
      constraint: 'goal_reachable',
      expected: `target_score <= max_possible_score (${best})`,
      actual: `target_score ${target} exceeds the best achievable build`,
      suggestion:
        'Lower target_score, extend the material pools, or improve the scoring matrix relations',
    })
  } else if (worst >= target) {
    violations.push({
      severity: 'warning',
      field_path: 'win_condition.params.target_score',
      constraint: 'goal_non_trivial',
      expected: `min_possible_score (${worst}) < target_score — the goal should require coordination`,
      actual: `even the worst assignment scores ${worst} >= ${target}`,
      suggestion: 'Raise target_score so the build requires actual coordination between the roles',
    })
  }

  return buildCheckResult('goal_reachability', violations)
}

function constructionModelViolation(path: string): Violation {
  return {
    severity: 'error',
    field_path: path,
    constraint: 'construction_model_declared',
    expected: 'the co_build construction model (initial_state + available_materials)',
    actual: 'missing',
    suggestion: 'Declare the construction starting space and per-role material pools',
  }
}

/** Best/worst total over assignments of pool B onto pool A (bounded permutations). */
function assignmentExtremes(
  model: ScoringModel,
  poolA: string[],
  poolB: string[],
  deadline: { timedOut(): boolean }
): { best: number; worst: number; timedOut: boolean } {
  let best = Number.NEGATIVE_INFINITY
  let worst = Number.POSITIVE_INFINITY
  let timedOut = false
  const used = new Array<boolean>(poolB.length).fill(false)
  const pairs = Math.min(poolA.length, poolB.length)

  const recurse = (index: number, total: number): void => {
    if (timedOut || deadline.timedOut()) {
      timedOut = true
      return
    }
    if (index === pairs) {
      best = Math.max(best, total)
      worst = Math.min(worst, total)
      return
    }
    for (let j = 0; j < poolB.length; j++) {
      if (used[j]) continue
      used[j] = true
      recurse(index + 1, total + pairScore(model, poolA[index], poolB[j]))
      used[j] = false
    }
  }
  recurse(0, 0)
  if (best === Number.NEGATIVE_INFINITY) {
    best = 0
    worst = 0
  }
  return { best, worst, timedOut }
}
