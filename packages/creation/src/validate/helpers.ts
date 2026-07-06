/**
 * Shared internals for the validator checks. All helpers are read-only over
 * their inputs (spec invariant: validators never modify the Level).
 *
 * Field-path convention: violations locate Level-side fields with the spec's
 * index format ("elements[2].params.color"). Fields that live on the GameType
 * side of the (GameType, Level) pair are prefixed with "game_type."
 * (e.g. "game_type.solver_strategy") — the spec only exemplifies Level-side
 * paths, so the prefix is this implementation's documented extension.
 */

import type {
  AttributeDefinition,
  CheckId,
  CheckResult,
  ElementArchetype,
  GameType,
  Level,
  LevelElement,
  LevelRule,
  RuleTemplate,
  Verdict,
  Violation,
} from '../schema/types'

export const WILDCARD = '*'

export function archetypesById(gameType: GameType): Map<string, ElementArchetype> {
  return new Map(gameType.element_archetypes.map((a) => [a.id, a]))
}

export function templatesById(gameType: GameType): Map<string, RuleTemplate> {
  return new Map(gameType.rule_templates.map((t) => [t.id, t]))
}

export function elementsById(level: Level): Map<string, LevelElement> {
  return new Map(level.elements.map((e) => [e.id, e]))
}

export function attributeNames(archetype: ElementArchetype): string[] {
  return archetype.attributes.map((a) => a.name)
}

export function stateNames(archetype: ElementArchetype): string[] {
  return (archetype.states ?? []).map((s) => s.name)
}

/** Expand a visibility name list: "*" means every name in `all`. */
export function expandNames(listed: string[], all: string[]): string[] {
  return listed.includes(WILDCARD) ? all : listed
}

export function isMappingValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

/**
 * Legal leaf value for AI-authored params/bindings under the ≤3-level
 * nesting invariant: a scalar, or an array of scalars (required by the
 * "set" attribute type). Mappings and nested arrays exceed the ceiling.
 */
export function isFlatValue(value: unknown): boolean {
  if (isScalar(value)) return true
  if (Array.isArray(value)) return value.every((item) => isScalar(item))
  return false
}

/** All non-null scalar leaves of a nested binding structure, depth-first. */
export function collectScalarLeaves(value: unknown): (string | number | boolean)[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [value]
  }
  if (Array.isArray(value)) return value.flatMap(collectScalarLeaves)
  if (typeof value === 'object') return Object.values(value).flatMap(collectScalarLeaves)
  return []
}

/** Size of an attribute's value domain; undefined when unknown/unbounded. */
export function attributeDomainSize(attr: AttributeDefinition): number | undefined {
  if (attr.type === 'enum' || attr.type === 'set') return attr.values?.length
  if (attr.type === 'boolean') return 2
  if (attr.type === 'range' && attr.min !== undefined && attr.max !== undefined) {
    const step = attr.step ?? 1
    return Math.floor((attr.max - attr.min) / step) + 1
  }
  return undefined
}

/**
 * Attribute-level visibility across ALL roles: element id → set of attribute
 * names at least one role can observe (from Level.information_partition,
 * with "*" expanded against the element's archetype).
 */
export function visibleAttributesByElement(
  gameType: GameType,
  level: Level
): Map<string, Set<string>> {
  const archetypes = archetypesById(gameType)
  const elements = elementsById(level)
  const visible = new Map<string, Set<string>>()
  for (const assignment of level.information_partition.role_assignments) {
    for (const view of assignment.element_views) {
      const element = elements.get(view.element_id)
      const archetype = element ? archetypes.get(element.archetype) : undefined
      const names = archetype
        ? expandNames(view.visible_attributes, attributeNames(archetype))
        : view.visible_attributes
      const set = visible.get(view.element_id) ?? new Set<string>()
      for (const name of names) set.add(name)
      visible.set(view.element_id, set)
    }
  }
  return visible
}

/**
 * Per-role attribute-level visibility: role id → element id → observable
 * attribute names (with "*" expanded against the element's archetype).
 */
export function visibleAttributesByRole(
  gameType: GameType,
  level: Level
): Map<string, Map<string, Set<string>>> {
  const archetypes = archetypesById(gameType)
  const elements = elementsById(level)
  const byRole = new Map<string, Map<string, Set<string>>>()
  for (const assignment of level.information_partition.role_assignments) {
    const roleMap = byRole.get(assignment.role) ?? new Map<string, Set<string>>()
    for (const view of assignment.element_views) {
      const element = elements.get(view.element_id)
      const archetype = element ? archetypes.get(element.archetype) : undefined
      const names = archetype
        ? expandNames(view.visible_attributes, attributeNames(archetype))
        : view.visible_attributes
      const set = roleMap.get(view.element_id) ?? new Set<string>()
      for (const name of names) set.add(name)
      roleMap.set(view.element_id, set)
    }
    byRole.set(assignment.role, roleMap)
  }
  return byRole
}

/** Shared bounded-search deadline (solver_timeout_ms bounds every solver-routed check). */
export interface Deadline {
  timedOut(): boolean
  violation(): Violation
}

/**
 * Deadline policy (H3): ONE deadline per check invocation —
 * solver_timeout_ms bounds the ENTIRE check (all targets and sub-phases
 * share the same budget). Consumers create exactly one deadline at check
 * entry and thread it through every bounded sub-step.
 */
export function startDeadline(timeoutMs: number): Deadline {
  const start = Date.now()
  return {
    timedOut: () => Date.now() - start >= timeoutMs,
    violation: () => ({
      severity: 'error',
      field_path: 'game_type.solver_timeout_ms',
      constraint: 'solver_timeout',
      expected: `the whole check completing within ${timeoutMs}ms (one deadline per check invocation)`,
      actual: 'the bounded search exceeded the check budget',
      suggestion: 'Raise solver_timeout_ms on the GameType or reduce the level complexity',
    }),
  }
}

/**
 * Instance params consumed by ONE rule — the v1 consumption approximation
 * (refined when the rule engine declares effect semantics): an element
 * referenced through an element-valued binding is rule MATERIAL — all its
 * params are consumed; an element referenced only as a target contributes
 * only params whose values appear among the rule's binding scalar leaves.
 */
export function consumedParamsForRule(
  gameType: GameType,
  level: Level,
  rule: LevelRule
): Map<string, Set<string>> {
  const elements = elementsById(level)
  const archetypes = archetypesById(gameType)
  const scalars = collectScalarLeaves(rule.bindings)
  const material = new Set<string>()
  for (const scalar of scalars) {
    if (typeof scalar === 'string' && elements.has(scalar)) material.add(scalar)
  }
  const valueSet = new Set(scalars.map(formatValue))
  const targets = new Set(rule.target_elements.filter((id) => elements.has(id)))
  const consumed = new Map<string, Set<string>>()
  for (const element of level.elements) {
    const isMaterial = material.has(element.id)
    if (!isMaterial && !targets.has(element.id)) continue
    const archetype = archetypes.get(element.archetype)
    if (!archetype) continue
    const attrNames = new Set(attributeNames(archetype))
    const params = new Set<string>()
    for (const [key, value] of Object.entries(element.params)) {
      if (!attrNames.has(key)) continue
      if (isMaterial || valueSet.has(formatValue(value))) params.add(key)
    }
    if (params.size > 0) consumed.set(element.id, params)
  }
  return consumed
}

/**
 * Solve-relevant instance params across all rules — union of
 * consumedParamsForRule. Shared by fairness and communication_completeness
 * (verbal_distinguishability does not consume it).
 */
export function solveRelevantParams(gameType: GameType, level: Level): Map<string, Set<string>> {
  const relevant = new Map<string, Set<string>>()
  for (const rule of level.rules) {
    for (const [elementId, params] of consumedParamsForRule(gameType, level, rule)) {
      const set = relevant.get(elementId) ?? new Set<string>()
      for (const param of params) set.add(param)
      relevant.set(elementId, set)
    }
  }
  return relevant
}

export function verdictOf(violations: Violation[]): Verdict {
  if (violations.some((v) => v.severity === 'error')) return 'fail'
  if (violations.length > 0) return 'warn'
  return 'pass'
}

export function buildCheckResult(checkType: CheckId, violations: Violation[]): CheckResult {
  return { check_type: checkType, verdict: verdictOf(violations), violations }
}

export function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
