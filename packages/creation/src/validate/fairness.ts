/**
 * fairness — the universal, partition-aware core of the spec's fairness
 * check: no solution step may depend on unreasoned guessing. Machine-checked
 * here: every param a rule actually CONSUMES must be observable by at least
 * one role. A hidden consumed param forces a guess over its attribute's
 * value domain; if the combined guess space exceeds the fairness threshold
 * (spec default 2), the level is unfair.
 *
 * Consumption follows the shared v1 approximation in
 * helpers.solveRelevantParams (material elements expose all params;
 * target-only elements only value-matched params). Unconsumed cosmetic
 * params may stay hidden without a fairness violation.
 *
 * The deeper, per-role deduction — whether observable information can
 * actually travel through the allowed channels to the acting role — is
 * form-specific and lives in the hidden_info_coop floor check
 * communication_completeness (R3), per the spec's check taxonomy.
 *
 * Levels with no role assignments (shared-state forms like co_build) pass
 * vacuously: with symmetric visibility there is no partition to hide behind.
 */

import type { CheckResult, GameType, Level, Violation } from '../schema/types'
import {
  archetypesById,
  attributeDomainSize,
  buildCheckResult,
  solveRelevantParams,
  visibleAttributesByElement,
} from './helpers'

/** Spec default: guessing among more than 2 equally likely options is unfair. */
const FAIRNESS_THRESHOLD = 2

export function checkFairness(gameType: GameType, level: Level): CheckResult {
  const violations: Violation[] = []
  if (level.information_partition.role_assignments.length === 0) {
    return buildCheckResult('fairness', violations)
  }

  const archetypes = archetypesById(gameType)
  const visible = visibleAttributesByElement(gameType, level)
  const relevant = solveRelevantParams(gameType, level)

  level.elements.forEach((element, i) => {
    const relevantParams = relevant.get(element.id)
    if (!relevantParams) return // not solution-relevant
    const archetype = archetypes.get(element.archetype)
    if (!archetype) return // schema_conformance reports the broken reference
    const attributesByName = new Map(archetype.attributes.map((a) => [a.name, a]))
    const visibleNames = visible.get(element.id) ?? new Set<string>()

    const hidden: string[] = []
    let guessSpace = 1
    for (const key of relevantParams) {
      const attribute = attributesByName.get(key)
      if (!attribute || visibleNames.has(key)) continue
      hidden.push(key)
      const domain = attributeDomainSize(attribute)
      guessSpace = domain === undefined ? Number.POSITIVE_INFINITY : guessSpace * domain
    }

    if (hidden.length > 0 && guessSpace > FAIRNESS_THRESHOLD) {
      const guessLabel = Number.isFinite(guessSpace) ? String(guessSpace) : 'unbounded'
      violations.push({
        severity: 'error',
        field_path: `elements[${i}]`,
        constraint: 'solution_information_observable',
        expected: `solution-relevant params observable by at least one role (guess space <= ${FAIRNESS_THRESHOLD})`,
        actual: `hidden params: ${hidden.join(', ')} (guess space ${guessLabel})`,
        suggestion: `Expose ${hidden.join(', ')} of "${element.id}" to at least one role in information_partition.role_assignments, or remove the element from solution-relevant rules`,
        related_elements: [element.id],
      })
    }
  })

  return buildCheckResult('fairness', violations)
}
