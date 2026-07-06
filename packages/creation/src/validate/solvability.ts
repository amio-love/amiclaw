/**
 * solvability — dispatches the GameType-declared solver_strategy under the
 * declared solver_timeout_ms bound (spec Mechanism 3, solvability
 * computability assumption).
 *
 * STRUCTURAL, NOT SEMANTIC (boundary). The solver verifies that a legal
 * sequence of declared operations reaches the win state — a solution PATH
 * exists structurally. It does NOT verify semantic answer-correctness: e.g.
 * apply_key advances a cipher_segment's decryption_progress regardless of
 * whether the caesar shift_amount actually decodes the plaintext, so a level
 * with a "wrong" key still passes structural solvability. Answer computation
 * is client-side / human-layer by project constraint ("Puzzle answer
 * calculation is client-side in the MVP", repo CLAUDE.md). The publish gate
 * therefore means "a legal operation sequence reaches the win", NOT "a human
 * can compute the correct answer".
 *
 * Implemented strategies (both run the same engine-backed bounded search —
 * the strategy id records the DECLARED approach for the GameType's state
 * space, the realization is one shared search core):
 * - exhaustive_path_search: BFS over declarative rule executions from the
 *   Level's initial state (../engine/search.ts), state-hash deduplicated,
 *   bounded by solver_timeout_ms. Declared for small state spaces.
 * - csp: same engine-backed bounded search — the state-hash frontier IS the
 *   constraint-propagation the spec's L492 CSP prose calls for on larger
 *   spaces (a reachable configuration satisfying the win constraints).
 *   Declared for larger state spaces (e.g. botanical-garden). A true
 *   constraint-model encoding remains a future optimization; the V0
 *   realization is measured to solve the botanical golden in ~99ms median /
 *   119ms max (R7 calibration).
 *
 * A found path proves reachability; exhaustion within the declared
 * vocabulary proves unsolvability. Structural pre-checks (win type, target
 * references, declared target state) run first for sharper diagnostics;
 * when the search fails, per-target driver analysis names the unreached
 * targets with near-miss binding suggestions. solvability and
 * communication_completeness's uniqueness sub-check share this one core.
 *
 * Diagnostic convention (provisional, documented since R2): a binding param
 * of type "string" whose name ends in "_id" is treated as an element
 * reference and must resolve to a level element instance. The spec's
 * param_def has no element-reference marker yet (R1 SPEC-DEFECT #1).
 */

import type {
  CheckResult,
  GameType,
  Level,
  LevelElement,
  LevelRule,
  RuleTemplate,
  Violation,
} from '../schema/types'
import { searchSolution, solutionDriversForTarget } from '../engine/search'
import {
  buildCheckResult,
  elementsById,
  isMappingValue,
  startDeadline,
  templatesById,
} from './helpers'

/** Registered solver strategies, both realized by the shared engine search. */
const IMPLEMENTED_STRATEGIES = ['exhaustive_path_search', 'csp'] as const

export function checkSolvability(gameType: GameType, level: Level): CheckResult {
  const violations: Violation[] = []
  if (!(IMPLEMENTED_STRATEGIES as readonly string[]).includes(gameType.solver_strategy)) {
    violations.push({
      severity: 'error',
      field_path: 'game_type.solver_strategy',
      constraint: 'solver_strategy_registered',
      expected: `one of [${IMPLEMENTED_STRATEGIES.join(', ')}]`,
      actual: gameType.solver_strategy,
      suggestion:
        'Declare an implemented solver strategy on the GameType, or register a solver for this strategy id',
    })
  } else {
    violations.push(...exhaustivePathSearch(gameType, level))
  }
  return buildCheckResult('solvability', violations)
}

function exhaustivePathSearch(gameType: GameType, level: Level): Violation[] {
  const violations: Violation[] = []
  const deadline = startDeadline(gameType.solver_timeout_ms)

  const winType = level.win_condition.type
  const SUPPORTED_WIN = ['all_solved', 'score_threshold', 'optimization_target']
  if (!SUPPORTED_WIN.includes(winType)) {
    // Any unrecognized win type stays typed-but-rejected — an explicit
    // violation, never a silently wrong verdict.
    violations.push({
      severity: 'error',
      field_path: 'win_condition.type',
      constraint: 'win_condition_supported',
      expected: `one of [${SUPPORTED_WIN.join(', ')}]`,
      actual: winType,
      suggestion:
        'Extend the solver registry with a strategy for this win condition type, or use a supported one',
    })
    return violations
  }

  const params = level.win_condition.params
  const archetypes = new Map(gameType.element_archetypes.map((a) => [a.id, a]))
  const templates = templatesById(gameType)
  const elements = elementsById(level)

  let targetIds: unknown[] = []
  if (winType === 'all_solved') {
    const declared = Array.isArray(params.target_elements)
      ? (params.target_elements as unknown[])
      : undefined
    if (!declared || declared.length === 0) {
      violations.push({
        severity: 'error',
        field_path: 'win_condition.params.target_elements',
        constraint: 'target_elements_declared',
        expected: 'a non-empty array of element instance ids',
        actual: JSON.stringify(params.target_elements),
        suggestion: 'Declare which element instances must reach the target state',
      })
      return violations
    }
    targetIds = declared
    const targetState = params.target_state

    // Structural pre-checks: broken references produce sharper diagnostics
    // than a failed search would.
    targetIds.forEach((targetId, j) => {
      const targetPath = `win_condition.params.target_elements[${j}]`
      if (typeof targetId !== 'string' || !elements.has(targetId)) {
        violations.push({
          severity: 'error',
          field_path: targetPath,
          constraint: 'element_reference',
          expected: `one of [${[...elements.keys()].join(', ')}]`,
          actual: String(targetId),
          suggestion: 'Reference an element instance declared in this level',
        })
        return
      }
      const element = elements.get(targetId)
      const archetype = element ? archetypes.get(element.archetype) : undefined
      if (typeof targetState === 'string' && archetype) {
        const stateReachable = (archetype.states ?? []).some(
          (state) => state.values?.includes(targetState) ?? false
        )
        if (!stateReachable) {
          violations.push({
            severity: 'error',
            field_path: 'win_condition.params.target_state',
            constraint: 'state_declared',
            expected: `a declared state value of archetype "${archetype.id}"`,
            actual: targetState,
            suggestion: `Use a state value declared on archetype "${archetype.id}" states`,
          })
        }
      }
    })
  } else if (winType === 'score_threshold') {
    if (typeof params.target_score !== 'number') {
      violations.push({
        severity: 'error',
        field_path: 'win_condition.params.target_score',
        constraint: 'target_score_declared',
        expected: 'a numeric target score',
        actual: JSON.stringify(params.target_score),
        suggestion: 'Declare the score threshold the build must reach',
      })
      return violations
    }
  } else {
    // optimization_target: at least one declarative constraint, and every
    // referenced state + value must exist in the vocabulary.
    violations.push(...validateOptimizationTargetParams(gameType, params))
  }
  if (violations.length > 0) return violations

  // Real bounded path search through the declarative rule engine.
  const result = searchSolution(gameType, level, deadline)
  if (result.timedOut) {
    violations.push(deadline.violation())
    return violations
  }
  if (result.solvable) return violations

  if (winType === 'score_threshold') {
    // Unsolvable build: no placement sequence within the vocabulary
    // reaches the threshold.
    violations.push({
      severity: 'error',
      field_path: 'win_condition.params.target_score',
      constraint: 'solution_path_exists',
      expected: 'a construction sequence reaching the target score',
      actual: `no reachable configuration scores >= ${String(params.target_score)}`,
      suggestion:
        'Lower target_score, extend the material pools, or improve the scoring matrix relations',
    })
    return violations
  }

  if (winType === 'optimization_target') {
    // Unsolvable care loop: no care sequence within the vocabulary satisfies
    // the optimization constraints.
    violations.push({
      severity: 'error',
      field_path: 'win_condition.params',
      constraint: 'solution_path_exists',
      expected: 'a care sequence reaching all optimization_target constraints',
      actual: 'no reachable configuration satisfies the win constraints',
      suggestion:
        'Relax the constraints, add action_event_mapping / rules that advance the required states, or fix the starting states',
    })
    return violations
  }

  // all_solved unsolvable: name each undrivable target with near-miss
  // diagnostics. Deadline policy (H3): ONE deadline per check invocation —
  // solver_timeout_ms bounds the whole solvability check; the driver
  // analysis spends whatever budget the search left, never a fresh one.
  let driverAnalysisTimedOut = false
  targetIds.forEach((targetId, j) => {
    if (driverAnalysisTimedOut || typeof targetId !== 'string') return
    const analysis = solutionDriversForTarget(gameType, level, targetId, deadline)
    if (analysis.timedOut) {
      // Partial driver analysis must never look like a clean verdict (G3).
      driverAnalysisTimedOut = true
      violations.push(deadline.violation())
      return
    }
    if (analysis.drivers.length > 0) return
    const nearMisses: string[] = []
    for (const rule of level.rules) {
      if (!rule.target_elements.includes(targetId)) continue
      const template = templates.get(rule.template)
      if (!template) continue
      const missing = missingBindings(template, rule, elements)
      if (missing.length > 0) nearMisses.push(`bind ${missing.join(', ')} on rule "${rule.id}"`)
    }
    violations.push({
      severity: 'error',
      field_path: `win_condition.params.target_elements[${j}]`,
      constraint: 'solution_path_exists',
      expected: 'a rule execution path driving this element to the win state',
      actual: `no rule execution drives "${targetId}" to the win state`,
      suggestion:
        nearMisses.length > 0
          ? nearMisses.join('; ')
          : `Add a rule instance targeting "${targetId}" with complete bindings`,
      related_elements: [targetId],
    })
  })

  return violations
}

/** Structural checks for optimization_target params: constraints present, states/values declared. */
function validateOptimizationTargetParams(
  gameType: GameType,
  params: Record<string, unknown>
): Violation[] {
  const violations: Violation[] = []
  const atLeast = Array.isArray(params.all_states_at_least) ? params.all_states_at_least : []
  const countEqual = Array.isArray(params.count_states_equal) ? params.count_states_equal : []
  if (atLeast.length === 0 && countEqual.length === 0) {
    violations.push({
      severity: 'error',
      field_path: 'win_condition.params',
      constraint: 'optimization_constraints_declared',
      expected: 'at least one all_states_at_least or count_states_equal constraint',
      actual: 'no optimization constraints declared',
      suggestion: 'Declare the states + target values the care loop must reach',
    })
    return violations
  }
  const stateValues = (stateName: string): string[] | undefined => {
    for (const archetype of gameType.element_archetypes) {
      const state = (archetype.states ?? []).find((s) => s.name === stateName)
      if (state?.values) return state.values
    }
    return undefined
  }
  const checkConstraint = (raw: unknown, path: string): void => {
    if (!isMappingValue(raw)) return
    const stateName = raw.state
    const value = raw.value
    if (typeof stateName !== 'string') return
    const values = stateValues(stateName)
    if (!values) {
      violations.push({
        severity: 'error',
        field_path: `${path}.state`,
        constraint: 'state_declared',
        expected: 'a declared enum state name of some archetype',
        actual: stateName,
        suggestion: 'Reference a state declared in the GameType vocabulary',
      })
    } else if (typeof value === 'string' && !values.includes(value)) {
      violations.push({
        severity: 'error',
        field_path: `${path}.value`,
        constraint: 'state_declared',
        expected: `one of [${values.join(', ')}]`,
        actual: value,
        suggestion: `Use a declared value of state "${stateName}"`,
      })
    }
  }
  atLeast.forEach((raw, j) =>
    checkConstraint(raw, `win_condition.params.all_states_at_least[${j}]`)
  )
  countEqual.forEach((raw, j) =>
    checkConstraint(raw, `win_condition.params.count_states_equal[${j}]`)
  )
  return violations
}

/**
 * Per-kind binding completeness — near-miss DIAGNOSTICS for failed
 * searches, following the canonical binding shapes of the spec Mechanism
 * binding contract: temporal_sequence needs every step param bound (element
 * refs resolving); condition_action needs a non-empty predicates[] with
 * declared params inlined; state_transition / interaction_matrix need a
 * non-empty transitions[] / matrix[].
 */
function missingBindings(
  template: RuleTemplate,
  rule: LevelRule,
  elements: Map<string, LevelElement>
): string[] {
  switch (template.type) {
    case 'temporal_sequence': {
      const missing: string[] = []
      for (const param of template.sequence_schema.step_schema.params) {
        const value = rule.bindings[param.name]
        if (value === undefined || value === null) {
          missing.push(param.name)
          continue
        }
        if (param.type === 'string' && param.name.endsWith('_id')) {
          if (typeof value !== 'string' || !elements.has(value)) missing.push(param.name)
        }
      }
      return missing
    }
    case 'condition_action': {
      const predicates = rule.bindings.predicates
      if (!Array.isArray(predicates) || predicates.length === 0) return ['predicates']
      const declared = new Map(template.condition_schema.predicates.map((p) => [p.name, p]))
      const missing: string[] = []
      predicates.forEach((entry, j) => {
        if (!isMappingValue(entry)) {
          missing.push(`predicates[${j}]`)
          return
        }
        const { name, ...inlined } = entry
        const predicate = typeof name === 'string' ? declared.get(name) : undefined
        if (!predicate) {
          missing.push(`predicates[${j}].name`)
          return
        }
        for (const param of predicate.params) {
          const value = inlined[param.name]
          if (value === undefined || value === null) {
            missing.push(`predicates[${j}].${param.name}`)
          } else if (
            param.type === 'string' &&
            param.name.endsWith('_id') &&
            (typeof value !== 'string' || !elements.has(value))
          ) {
            missing.push(`predicates[${j}].${param.name}`)
          }
        }
      })
      return missing
    }
    case 'state_transition':
      return Array.isArray(rule.bindings.transitions) && rule.bindings.transitions.length > 0
        ? []
        : ['transitions']
    case 'interaction_matrix':
      return Array.isArray(rule.bindings.matrix) && rule.bindings.matrix.length > 0
        ? []
        : ['matrix']
  }
}
