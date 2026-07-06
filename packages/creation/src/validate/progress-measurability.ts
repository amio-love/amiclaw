/**
 * progress_measurability — co_build floor check (spec interface:
 * `(level_state, win_condition) → {progress: float[0,1],
 * remaining_steps_estimate: int}`; the spec pins ONE formula:
 * `progress = min(current_score / target_score, 1.0)` and
 * `remaining_steps = |empty_slots_with_both_pieces_available|`).
 *
 * As a design-time floor check this verifies BOTH terms are computable for
 * the level: a positive numeric target (the progress divisor), a declared
 * scoring source (matrix relation_scores), the construction slot model
 * (initial_state.timeline_slots), the remaining-steps metric itself
 * (engine/rules.remainingSteps, which needs the matrix pair_match slot
 * key) — and that the fully-built designed configuration yields a finite
 * score that reaches the target (progress can hit 1.0).
 */

import type { CheckResult, GameType, Level, Violation } from '../schema/types'
import {
  buildRuleContext,
  currentScore,
  initialElementStates,
  PLACEMENT_STATE,
  remainingSteps,
} from '../engine/rules'
import { buildCheckResult } from './helpers'
import { scoringModel } from './goal-reachability'

export function checkProgressMeasurability(gameType: GameType, level: Level): CheckResult {
  const violations: Violation[] = []

  const target = level.win_condition.params.target_score
  if (typeof target !== 'number' || target <= 0) {
    violations.push({
      severity: 'error',
      field_path: 'win_condition.params.target_score',
      constraint: 'progress_computable',
      expected: 'a positive numeric target score (the progress denominator)',
      actual: JSON.stringify(target),
      suggestion: 'Declare a positive target_score so progress = min(current/target, 1) is defined',
    })
  }

  if (!scoringModel(gameType, level)) {
    violations.push({
      severity: 'error',
      field_path: 'game_type.rule_templates',
      constraint: 'score_source_declared',
      expected:
        'an interaction_matrix rule with matrix_schema.relation_scores (the current_score source)',
      actual: 'no scoring source found',
      suggestion:
        'Declare relation_scores on the matrix template and bind a matrix rule in the level',
    })
  }

  if (!level.initial_state || typeof level.initial_state.timeline_slots !== 'number') {
    violations.push({
      severity: 'error',
      field_path: 'initial_state',
      constraint: 'construction_model_declared',
      expected: 'initial_state with a numeric timeline_slots (the remaining-steps slot model)',
      actual: level.initial_state ? 'timeline_slots missing' : 'missing',
      suggestion: 'Declare the construction starting space so remaining steps are countable',
    })
  }

  if (violations.length === 0) {
    const ctx = buildRuleContext(gameType, level)

    // remaining_steps term: must be computable from the initial state
    // (needs the matrix pair_match slot key besides timeline_slots).
    const initialStates = initialElementStates(gameType, level)
    if (remainingSteps(ctx, initialStates) === undefined) {
      violations.push({
        severity: 'error',
        field_path: 'initial_state',
        constraint: 'progress_computable',
        expected:
          'a computable remaining_steps metric (timeline_slots + a matrix pair_match slot key)',
        actual: 'remaining_steps is not computable for this level',
        suggestion:
          'Declare pair_match_attributes on the matrix template so empty slots can be counted',
      })
    }

    // Progress must be able to REACH 1.0: the fully-built designed
    // configuration must yield a finite score at or above the target.
    const states = initialElementStates(gameType, level)
    for (const machine of states.values()) {
      if (machine.has(PLACEMENT_STATE)) machine.set(PLACEMENT_STATE, 'placed')
    }
    const designedScore = currentScore(ctx, states)
    if (designedScore === undefined || !Number.isFinite(designedScore)) {
      violations.push({
        severity: 'error',
        field_path: 'elements',
        constraint: 'progress_computable',
        expected: 'a finite current_score over the designed configuration',
        actual: String(designedScore),
        suggestion: 'Check the matrix rule bindings and relation_scores cover the designed pairs',
      })
    } else if (typeof target === 'number' && designedScore < target) {
      violations.push({
        severity: 'error',
        field_path: 'elements',
        constraint: 'designed_goal_score',
        expected: `the designed configuration scoring >= target_score (${target})`,
        actual: `the designed configuration scores ${designedScore}`,
        suggestion:
          'Fix the matrix rows / relation scores or the designed pairings so the authored layout can reach the win',
      })
    }
  }

  return buildCheckResult('progress_measurability', violations)
}
