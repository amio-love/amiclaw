/**
 * construction_visibility — co_build floor check (F5). co_build is a
 * shared-construction form: every participating BUILDER role coordinates by
 * observing the shared construction space. This floor requires each builder
 * role to see a non-empty slice of that space — its Level element_views must
 * cover every construction archetype (the archetypes any builder can place).
 *
 * A builder role is one whose action_capability.can_perform includes a
 * player-performable construction action (construction_effect set). The
 * construction archetypes are the union of archetypes those construction
 * actions may target (target_archetypes; empty list = all). A builder blind
 * to (part of) the construction space cannot coordinate the cross-role
 * pairing the co_build score depends on, so the level must not publish.
 *
 * Interface: (level, role_capabilities) → {each builder covers the
 * construction archetypes}. Read-only over both inputs.
 */

import type { CheckResult, GameType, Level, Violation } from '../schema/types'
import { buildCheckResult } from './helpers'

export function checkConstructionVisibility(gameType: GameType, level: Level): CheckResult {
  const violations: Violation[] = []
  const template = gameType.information_partition_template
  const registry = new Map(gameType.action_registry.map((action) => [action.name, action]))
  const allArchetypeIds = gameType.element_archetypes.map((archetype) => archetype.id)

  // Builder roles + the construction archetypes some role can place/remove.
  const builderRoles: string[] = []
  const constructionArchetypes = new Set<string>()
  for (const capability of template?.action_capability ?? []) {
    let isBuilder = false
    const placeable = new Set<string>()
    for (const actionName of capability.can_perform) {
      const action = registry.get(actionName)
      if (!action || action.scope === 'rule_verb' || !action.construction_effect) continue
      isBuilder = true
      const targets =
        capability.target_archetypes.length > 0 ? capability.target_archetypes : allArchetypeIds
      for (const archetypeId of targets) placeable.add(archetypeId)
    }
    if (isBuilder) {
      builderRoles.push(capability.role)
      for (const archetypeId of placeable) constructionArchetypes.add(archetypeId)
    }
  }

  const archetypeOf = new Map(level.elements.map((element) => [element.id, element.archetype]))
  const assignmentIndex = new Map(
    level.information_partition.role_assignments.map((assignment, i) => [assignment.role, i])
  )
  const required = [...constructionArchetypes]

  for (const role of builderRoles) {
    const i = assignmentIndex.get(role)
    const assignment = i !== undefined ? level.information_partition.role_assignments[i] : undefined
    const seen = new Set<string>()
    for (const view of assignment?.element_views ?? []) {
      const archetype = archetypeOf.get(view.element_id)
      if (archetype) seen.add(archetype)
    }
    const missing = required.filter((archetypeId) => !seen.has(archetypeId))
    if (missing.length > 0) {
      violations.push({
        severity: 'error',
        field_path:
          i !== undefined
            ? `information_partition.role_assignments[${i}].element_views`
            : 'information_partition.role_assignments',
        constraint: 'builder_sees_construction_space',
        expected: `builder role "${role}" to observe every construction archetype [${required.join(', ')}]`,
        actual:
          assignment === undefined
            ? `role "${role}" has no element views`
            : `role "${role}" sees [${[...seen].join(', ') || 'nothing'}]; missing [${missing.join(', ')}]`,
        suggestion: `Give builder role "${role}" element views covering [${missing.join(', ')}] so it can coordinate over the shared construction space`,
      })
    }
  }

  return buildCheckResult('construction_visibility', violations)
}
