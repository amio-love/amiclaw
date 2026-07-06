/**
 * communication_completeness — hidden_info_coop floor check (spec Mechanism 3
 * contract: static coverage + bounded solution uniqueness + surface version
 * binding).
 *
 * Sub-check (i) STATIC COVERAGE — per-consuming-role sufficiency: every
 * solve-relevant field must be visible to, or transmissible to, the role(s)
 * that actually CONSUME it. Consuming roles derive from the partition
 * template's rule_visibility: the roles that can see a rule (hold its
 * "manual" entry) consume that rule's solve-relevant fields (per
 * helpers.consumedParamsForRule); the acting role receives derived
 * INSTRUCTIONS, not raw field values — radio-cipher's plaintext_category is
 * decoder-consumed, the listener never needs the field itself. Rules
 * visible to no role (engine-internal passive rules) impose no coverage
 * requirement. Channel forbidden_content entries are opaque content-type
 * tags with no schema link to fields (documented spec gap / Open Questions),
 * so a declared channel counts as transmissible. Achieved complexity:
 * O(|rules| × F × R × C) with R = 2 — inside the spec's
 * O(|elements| × |visible_fields|²) envelope.
 *
 * Sub-check (ii) SOLUTION UNIQUENESS (bounded) — under the merged two-role
 * information, each win-condition target must admit AT MOST one independent
 * solution pipeline (existence is solvability's concern). Counted through
 * the rule ENGINE: engine/search.ts's solutionDriversForTarget simulates
 * each rule alone from the initial state and counts the rules that drive
 * the target to the win state — the same declarative execution core that
 * powers solvability's path search (the earlier pipeline-counting vs
 * coverage divergence is dissolved). A rule that cannot change state — e.g.
 * a condition_action whose semantic predicates never auto-fire — is
 * naturally not a driver. Bounded by the shared solver_timeout_ms deadline;
 * a trip emits its own violation, never a fake pass.
 *
 * Scope: exactly 2 communicating roles (spec design debt: multi-role
 * extension is an open question) — any other count is an explicit
 * violation. Surface version binding (spec item 3) runs regardless of the
 * role count so both defects surface in one pass.
 */

import { solutionDriversForTarget } from '../engine/search'
import type { CheckResult, GameType, Level, Violation } from '../schema/types'
import {
  buildCheckResult,
  consumedParamsForRule,
  elementsById,
  startDeadline,
  visibleAttributesByRole,
  WILDCARD,
} from './helpers'

export function checkCommunicationCompleteness(gameType: GameType, level: Level): CheckResult {
  const violations: Violation[] = []
  const assignments = level.information_partition.role_assignments

  if (assignments.length !== 2) {
    violations.push({
      severity: 'error',
      field_path: 'information_partition.role_assignments',
      constraint: 'two_role_scope',
      expected: 'exactly 2 communicating roles (multi-role extension is declared spec design debt)',
      actual: `${assignments.length} role assignment(s)`,
      suggestion:
        'Model the level with exactly two communicating roles, or defer to the multi-role extension',
    })
  } else {
    checkStaticCoverage(gameType, level, violations)
    checkSolutionUniqueness(gameType, level, violations)
  }

  const levelVersion = level.metadata.game_type_version
  ;(level.communication_surfaces ?? []).forEach((surface, s) => {
    if (surface.game_type_version !== levelVersion) {
      violations.push({
        severity: 'error',
        field_path: `communication_surfaces[${s}].game_type_version`,
        constraint: 'version_binding',
        expected: levelVersion,
        actual: surface.game_type_version,
        suggestion: 'Regenerate the communication surface against the level game_type_version',
      })
    }
  })

  return buildCheckResult('communication_completeness', violations)
}

/** Sub-check (i): per-consuming-role observable-or-transmissible coverage. */
function checkStaticCoverage(gameType: GameType, level: Level, violations: Violation[]): void {
  const roleIds = level.information_partition.role_assignments.map((a) => a.role)
  const views = visibleAttributesByRole(gameType, level)
  const template = gameType.information_partition_template
  const channels = template?.communication_channels ?? []
  const ruleVisibility = template?.rule_visibility ?? []
  const elementIndex = new Map(level.elements.map((element, i) => [element.id, i]))
  const reported = new Set<string>()

  const rolesKnowing = (templateId: string): string[] =>
    ruleVisibility
      .filter(
        (entry) =>
          entry.visible_rule_templates.includes(WILDCARD) ||
          entry.visible_rule_templates.includes(templateId)
      )
      .map((entry) => entry.role)

  for (const rule of level.rules) {
    const consumers = rolesKnowing(rule.template).filter((role) => roleIds.includes(role))
    if (consumers.length === 0) continue // engine-internal rule: no human consumption
    for (const [elementId, attrs] of consumedParamsForRule(gameType, level, rule)) {
      const k = elementIndex.get(elementId)
      for (const attr of attrs) {
        const seers = roleIds.filter((role) => views.get(role)?.get(elementId)?.has(attr) ?? false)
        for (const role of consumers) {
          const key = `${elementId}|${attr}|${role}`
          if (reported.has(key) || seers.includes(role)) continue
          const reachable = channels.some(
            (channel) => channel.to === role && seers.includes(channel.from)
          )
          if (!reachable) {
            reported.add(key)
            violations.push({
              severity: 'error',
              field_path: `elements[${k}].params.${attr}`,
              constraint: 'communication_coverage',
              expected: `"${attr}" observable by its consuming role "${role}" or transmissible to it through a declared legal channel`,
              actual:
                seers.length === 0
                  ? 'no role can observe the field'
                  : `only [${seers.join(', ')}] observe it and no declared channel reaches "${role}"`,
              suggestion: `Expose "${attr}" of "${elementId}" to role "${role}" in information_partition.role_assignments, or declare a communication channel from an observing role to "${role}"`,
              related_elements: [elementId],
            })
          }
        }
      }
    }
  }
}

/**
 * Sub-check (ii): merged-information solution uniqueness (engine-backed,
 * bounded). Deadline policy (H3): ONE deadline per check invocation —
 * solver_timeout_ms bounds this whole sub-check; all targets share it.
 */
function checkSolutionUniqueness(gameType: GameType, level: Level, violations: Violation[]): void {
  const deadline = startDeadline(gameType.solver_timeout_ms)
  const elements = elementsById(level)
  const targets = Array.isArray(level.win_condition.params.target_elements)
    ? (level.win_condition.params.target_elements as unknown[])
    : []

  for (const [j, targetId] of targets.entries()) {
    if (deadline.timedOut()) {
      violations.push(deadline.violation())
      return
    }
    if (typeof targetId !== 'string' || !elements.has(targetId)) continue // solvability reports
    const analysis = solutionDriversForTarget(gameType, level, targetId, deadline)
    if (analysis.timedOut) {
      // An interrupted count is partial — surface the deadline, never a
      // silent uniqueness pass (G3).
      violations.push(deadline.violation())
      return
    }
    const drivers = analysis.drivers
    if (drivers.length > 1) {
      violations.push({
        severity: 'error',
        field_path: `win_condition.params.target_elements[${j}]`,
        constraint: 'solution_unique',
        expected:
          "at most one independent solution pipeline per target under the merged two-role information (existence is solvability's concern)",
        actual: `${drivers.length} independent solution pipelines drive "${targetId}": ${drivers
          .map((rule) => rule.id)
          .join(', ')}`,
        suggestion: `Remove or re-target one of [${drivers
          .map((rule) => rule.id)
          .join(', ')}] so the merged information admits a single solution`,
        related_elements: [targetId],
      })
    }
  }
}
