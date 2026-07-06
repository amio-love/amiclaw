/**
 * budget_compliance — DifficultyBudget + CommunicationBudget bounds from the
 * GameType against the Level instance, per the spec's precise-count
 * partition-complexity formula and communication derivation. Includes the
 * per-instance shared-label uniqueness check the spec places inside
 * budget_compliance.
 *
 * Declared-value rounding convention (pinned in spec Mechanism 4): declared
 * difficulty values are rounded half-up to 2 decimals; the validator rounds
 * its recomputed values the same way and compares within ±0.005. Seconds
 * estimates keep a pragmatic ±0.5s bound.
 */

import type { CheckResult, ElementArchetype, GameType, Level, Violation } from '../schema/types'
import {
  archetypesById,
  attributeNames,
  buildCheckResult,
  expandNames,
  formatValue,
  stateNames,
  templatesById,
  WILDCARD,
} from './helpers'

/** ±0.005 — matches the spec's round-half-up-to-2-decimals declaration rule. */
const ROUNDING_TOLERANCE = 0.005
const SECONDS_TOLERANCE = 0.5

/** Spec rounding convention for declared values: round half-up, 2 decimals. */
function roundHalfUp2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function checkBudgetCompliance(gameType: GameType, level: Level): CheckResult {
  const violations: Violation[] = []
  const budget = gameType.difficulty_budget

  // --- Difficulty: declared vs actual, and actual vs budget bounds ---
  const actualElements = level.elements.length
  const actualRules = level.rules.length
  checkDeclaredCount(
    'difficulty.element_count',
    level.difficulty.element_count,
    actualElements,
    violations
  )
  checkDeclaredCount('difficulty.rule_count', level.difficulty.rule_count, actualRules, violations)
  checkBudgetRange(
    'difficulty.element_count',
    actualElements,
    budget.element_count.min,
    budget.element_count.max,
    violations
  )
  checkBudgetRange(
    'difficulty.rule_count',
    actualRules,
    budget.rule_count.min,
    budget.rule_count.max,
    violations
  )

  const computedComplexity = partitionComplexity(gameType)
  const roundedComplexity =
    computedComplexity === undefined ? undefined : roundHalfUp2(computedComplexity)
  if (computedComplexity !== undefined && roundedComplexity !== undefined) {
    if (Math.abs(roundedComplexity - level.difficulty.partition_complexity) > ROUNDING_TOLERANCE) {
      violations.push({
        severity: 'error',
        field_path: 'difficulty.partition_complexity',
        constraint: 'declared_matches_actual',
        expected: `${roundedComplexity} (recomputed per the spec formula, rounded half-up to 2 decimals)`,
        actual: String(level.difficulty.partition_complexity),
        suggestion:
          'Recompute partition_complexity from the GameType partition template (roles hidden ratios + channel constraint counts)',
      })
    }
    if (computedComplexity > budget.partition_complexity.max) {
      violations.push({
        severity: 'error',
        field_path: 'difficulty.partition_complexity',
        constraint: 'budget_range',
        expected: `<= ${budget.partition_complexity.max}`,
        actual: computedComplexity.toFixed(4),
        suggestion:
          'Simplify the information partition (fewer hidden fields or channel constraints) to fit the budget',
      })
    }
  }

  // Score recomputation uses the ROUNDED complexity — the spec's declaration
  // convention composes rounded values, so 5 + 4.5 + 3.71*2 = 16.92 exactly.
  const complexityForScore = roundedComplexity ?? level.difficulty.partition_complexity
  const computedScore = roundHalfUp2(
    actualElements * budget.weights.element +
      actualRules * budget.weights.rule +
      complexityForScore * budget.weights.partition
  )
  if (Math.abs(computedScore - level.difficulty.total_score) > ROUNDING_TOLERANCE) {
    violations.push({
      severity: 'error',
      field_path: 'difficulty.total_score',
      constraint: 'declared_matches_actual',
      expected: `${computedScore} (weighted sum of actual counts and rounded partition complexity)`,
      actual: String(level.difficulty.total_score),
      suggestion:
        'Recompute total_score = element_count*w.element + rule_count*w.rule + partition_complexity*w.partition',
    })
  }
  if (computedScore < budget.total_score.min || computedScore > budget.total_score.max) {
    violations.push({
      severity: 'error',
      field_path: 'difficulty.total_score',
      constraint: 'budget_range',
      expected: `${budget.total_score.min}..${budget.total_score.max}`,
      actual: computedScore.toFixed(4),
      suggestion:
        'Adjust element/rule/partition complexity so the weighted total lands inside the budget',
    })
  }

  checkSharedLabelUniqueness(gameType, level, violations)
  checkCommunicationBudget(gameType, level, violations)

  return buildCheckResult('budget_compliance', violations)
}

function checkDeclaredCount(
  path: string,
  declared: number,
  actual: number,
  violations: Violation[]
): void {
  if (declared !== actual) {
    violations.push({
      severity: 'error',
      field_path: path,
      constraint: 'declared_matches_actual',
      expected: String(actual),
      actual: String(declared),
      suggestion: `Set ${path} to the actual count (${actual})`,
    })
  }
}

function checkBudgetRange(
  path: string,
  actual: number,
  min: number,
  max: number,
  violations: Violation[]
): void {
  if (actual < min || actual > max) {
    violations.push({
      severity: 'error',
      field_path: path,
      constraint: 'budget_range',
      expected: `${min}..${max}`,
      actual: String(actual),
      suggestion: `Bring the count within the GameType difficulty budget (${min}..${max})`,
    })
  }
}

/**
 * Spec Mechanism 4 precise-count semantics:
 * partition_complexity = |roles| * mean(hidden_ratio(role))
 *                      + |channels| * mean(constraint_count(channel))
 * Wildcards in cannot_see expand to the archetype's full attribute/state
 * name lists. Returns undefined when the GameType has no partition template.
 */
export function partitionComplexity(gameType: GameType): number | undefined {
  const template = gameType.information_partition_template
  if (!template || template.roles.length === 0) return undefined
  const archetypes = archetypesById(gameType)

  const totalFields = gameType.element_archetypes.reduce(
    (sum, archetype) => sum + archetype.attributes.length + (archetype.states ?? []).length,
    0
  )

  const hiddenRatios = template.roles.map((role) => {
    const rule = template.visibility_rules.find((entry) => entry.role === role.id)
    let hidden = 0
    for (const entry of rule?.cannot_see ?? []) {
      const matched: ElementArchetype[] = []
      if (entry.element_archetype === WILDCARD) {
        matched.push(...archetypes.values())
      } else {
        const single = archetypes.get(entry.element_archetype)
        if (single) matched.push(single)
      }
      for (const archetype of matched) {
        hidden += expandNames(entry.attributes, attributeNames(archetype)).length
        hidden += expandNames(entry.states, stateNames(archetype)).length
      }
    }
    return totalFields > 0 ? hidden / totalFields : 0
  })
  const rolesTerm = template.roles.length * mean(hiddenRatios)

  const constraintCounts = template.communication_channels.map((channel) => {
    const constraints = channel.constraints
    return (
      (constraints.forbidden_content?.length ?? 0) +
      (constraints.max_words_per_turn !== undefined ? 1 : 0) +
      (constraints.turn_time_limit_seconds !== undefined ? 1 : 0)
    )
  })
  const channelsTerm =
    template.communication_channels.length === 0
      ? 0
      : template.communication_channels.length * mean(constraintCounts)

  return rolesTerm + channelsTerm
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Per-instance label uniqueness (spec places it inside budget_compliance):
 * for every shared_label_attributes archetype, all level instances must have
 * pairwise-distinct value combinations of the declared attributes —
 * otherwise the rendered instance_labels collide and voice co-reference
 * breaks.
 */
function checkSharedLabelUniqueness(
  gameType: GameType,
  level: Level,
  violations: Violation[]
): void {
  const entries = gameType.information_partition_template?.shared_label_attributes ?? []
  for (const entry of entries) {
    const seen = new Map<string, { id: string; index: number }>()
    level.elements.forEach((element, i) => {
      if (element.archetype !== entry.element_archetype) return
      const combo = entry.attributes.map((attr) => formatValue(element.params[attr])).join('|')
      const first = seen.get(combo)
      if (first) {
        violations.push({
          severity: 'error',
          field_path: `elements[${i}].params.${entry.attributes[0]}`,
          constraint: 'instance_label_unique',
          expected: `pairwise-distinct ${entry.attributes.join('+')} combinations across "${entry.element_archetype}" instances`,
          actual: `"${first.id}" and "${element.id}" share ${entry.attributes.join('+')} = ${combo}`,
          suggestion:
            'Add a mutually visible disambiguating attribute or reduce the number of instances sharing the same attribute values',
          related_elements: [first.id, element.id],
        })
      } else {
        seen.set(combo, { id: element.id, index: i })
      }
    })
  }
}

function checkCommunicationBudget(gameType: GameType, level: Level, violations: Violation[]): void {
  const templates = templatesById(gameType)
  const rawWeight = level.rules.reduce((sum, rule) => {
    const template = templates.get(rule.template)
    return template ? sum + template.communication_weight : sum
  }, 0)
  const estimate = level.communication_estimate
  // Spec Mechanism 4: rule weights cover rule evaluation only; declared
  // coordination rounds (co_build proposal/division turns) add on top.
  const coordination = estimate.coordination_round_trips ?? 0
  const computedRoundTrips = Math.ceil(rawWeight - 1e-9) + coordination
  const communicationBudget = gameType.communication_budget

  if (computedRoundTrips !== estimate.round_trips) {
    violations.push({
      severity: 'error',
      field_path: 'communication_estimate.round_trips',
      constraint: 'declared_matches_actual',
      expected: `${computedRoundTrips} (ceil of summed template communication_weight ${rawWeight} + coordination_round_trips ${coordination})`,
      actual: String(estimate.round_trips),
      suggestion:
        'Recompute round_trips = ceil(sum of rule template communication_weight) + coordination_round_trips',
    })
  }
  if (computedRoundTrips > communicationBudget.max_round_trips) {
    violations.push({
      severity: 'error',
      field_path: 'communication_estimate.round_trips',
      constraint: 'budget_range',
      expected: `<= ${communicationBudget.max_round_trips}`,
      actual: String(computedRoundTrips),
      suggestion:
        'Remove or simplify rules until the derived round trips fit the communication budget',
    })
  }

  const computedSeconds = computedRoundTrips * communicationBudget.estimated_seconds_per_round
  if (Math.abs(computedSeconds - estimate.estimated_seconds) > SECONDS_TOLERANCE) {
    violations.push({
      severity: 'error',
      field_path: 'communication_estimate.estimated_seconds',
      constraint: 'declared_matches_actual',
      expected: `${computedSeconds} (round_trips * estimated_seconds_per_round)`,
      actual: String(estimate.estimated_seconds),
      suggestion:
        'Recompute estimated_seconds = round_trips * communication_budget.estimated_seconds_per_round',
    })
  }

  // The GameType communication budget is authoritative for the time limit;
  // a Level-authored time_limit_seconds must match it, and feasibility is
  // computed from the GameType value (an inflated Level limit cannot buy
  // feasibility).
  const timeLimit = communicationBudget.time_limit_seconds
  if (estimate.time_limit_seconds !== timeLimit) {
    violations.push({
      severity: 'error',
      field_path: 'communication_estimate.time_limit_seconds',
      constraint: 'declared_matches_actual',
      expected: String(timeLimit),
      actual: String(estimate.time_limit_seconds),
      suggestion:
        'Use the GameType communication_budget.time_limit_seconds — Level-side overrides are not budget-authoritative',
    })
  }
  const computedFeasibility =
    computedSeconds <= timeLimit * communicationBudget.safety_margin
      ? 'feasible'
      : computedSeconds <= timeLimit
        ? 'tight'
        : 'infeasible'
  if (computedFeasibility !== estimate.feasibility) {
    violations.push({
      severity: 'error',
      field_path: 'communication_estimate.feasibility',
      constraint: 'declared_matches_actual',
      expected: computedFeasibility,
      actual: estimate.feasibility,
      suggestion:
        'Recompute feasibility from estimated_seconds vs time_limit_seconds * safety_margin',
    })
  }
  if (computedFeasibility === 'infeasible') {
    violations.push({
      severity: 'error',
      field_path: 'communication_estimate.feasibility',
      constraint: 'communication_feasible',
      expected: `estimated communication (${computedSeconds}s) within the game time limit (${timeLimit}s)`,
      actual: 'infeasible',
      suggestion: 'Reduce rule communication weight or raise the time limit',
    })
  } else if (computedFeasibility === 'tight') {
    violations.push({
      severity: 'warning',
      field_path: 'communication_estimate.feasibility',
      constraint: 'communication_feasible',
      expected: `estimated communication within time_limit * safety_margin (${timeLimit * communicationBudget.safety_margin}s)`,
      actual: `tight: ${computedSeconds}s of ${timeLimit}s with no safety margin left`,
      suggestion: 'Leave safety margin: trim a rule or raise the time limit',
    })
  }
}
