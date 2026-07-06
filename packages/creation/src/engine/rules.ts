/**
 * THE single rule-execution core (spec Mechanism 1 semantics). GameSession,
 * searchSolution and solutionDriversForTarget all execute rules through the
 * functions in this file — one semantics source, so the solver can never
 * report solvable for a level the live engine cannot play (and vice versa).
 *
 * Execution semantics (all data-driven, zero game-specific logic):
 * - Element runtime state initializes from the archetype's declared states
 *   (`initial`, else the first declared value).
 * - An action's `state_effect` applies to a stateful element's FIRST
 *   declared state machine: advance_state moves one position along the
 *   declared value order (clamped), complete_state jumps to the terminal
 *   value. Unknown values are REJECTED as no-ops (never silently advance);
 *   gametype_consistency flags them at registration.
 * - temporal_sequence: one step per execution, bounded by max_steps per
 *   rule instance; the step action's state_effect applies to the rule's
 *   stateful target elements.
 * - state_transition: fires only under an EVENT. Events come exclusively
 *   from action_event_mapping rows via the spec-pinned
 *   `<rule_template_id>_event` column convention — no mapping row, no
 *   event, no transition (in the live engine AND in the solver).
 * - temporal_sequence / condition_action / interaction_matrix: fire only via
 *   their INTENDED trigger action — the performed action must list the rule's
 *   template in its `triggers` (see actionTriggers). This completes for the
 *   value-less rule kinds the same action-gating discipline state_transition
 *   gets from events: a pure-communication action (no `triggers`) can never
 *   advance game state, even on an element it may target.
 * - condition_action: predicates evaluate structurally (inlined params
 *   resolve by name against attributes / runtime states); semantic
 *   predicates never auto-fire. Combinators: AND = all, OR = any,
 *   NOT = none. A true condition applies the action tuple verb's
 *   state_effect to the satisfying element.
 * - interaction_matrix: entity types read from the spec-declared
 *   matrix_schema.entity_type_attributes (first attribute present on the
 *   element); unordered target pairs are considered only after the optional
 *   pair_match_attributes eligibility filter passes (equal values on every
 *   named param — all pairs only when the filter is omitted) and both
 *   members are PLACED under the construction model; an eligible pair with
 *   a matching matrix row gets the relation's effect action state_effect
 *   applied to both members.
 * - Construction (co_build): a Level with initial_state gets the reserved
 *   PLACEMENT_STATE runtime key per element; actions declaring
 *   construction_effect place/remove toggle it. Scoring
 *   (matrix_schema.relation_scores) sums eligible PLACED pairs' relations.
 * - Win: all_solved — every target element has some declared runtime state
 *   equal to target_state; score_threshold — currentScore >= target_score;
 *   optimization_target — the declarative all_states_at_least /
 *   count_states_equal constraints, ranked by each state's declared value
 *   order (see evaluateOptimizationTarget).
 */

import type {
  ConstructionEffect,
  ElementArchetype,
  GameType,
  Level,
  LevelElement,
  LevelRule,
  RuleTemplate,
  StateEffect,
} from '../schema/types'
import { archetypesById, elementsById, isMappingValue, templatesById } from '../validate/helpers'

export type ElementStates = Map<string, Map<string, unknown>>

/**
 * Reserved engine-internal runtime key tracking the co_build construction
 * model (Level.initial_state): present on every element's machine when the
 * level declares initial_state, absent otherwise (radio-cipher unchanged).
 * Never part of the declared state vocabulary, never exposed via role views.
 */
export const PLACEMENT_STATE = '__placed'

export interface RuleContext {
  gameType: GameType
  level: Level
  archetypes: Map<string, ElementArchetype>
  elements: Map<string, LevelElement>
  templates: Map<string, RuleTemplate>
  actions: Map<string, GameType['action_registry'][number]>
}

export function buildRuleContext(gameType: GameType, level: Level): RuleContext {
  return {
    gameType,
    level,
    archetypes: archetypesById(gameType),
    elements: elementsById(level),
    templates: templatesById(gameType),
    actions: new Map(gameType.action_registry.map((entry) => [entry.name, entry])),
  }
}

/** Initialize runtime states for every stateful element instance. */
export function initialElementStates(gameType: GameType, level: Level): ElementStates {
  const archetypes = archetypesById(gameType)
  const states: ElementStates = new Map()
  for (const element of level.elements) {
    const archetype = archetypes.get(element.archetype)
    const machine = new Map<string, unknown>()
    for (const state of archetype?.states ?? []) {
      // Per-instance initial_states override the archetype initial.
      const override = element.initial_states?.[state.name]
      machine.set(state.name, override ?? state.initial ?? state.values?.[0])
    }
    if (level.initial_state) {
      machine.set(
        PLACEMENT_STATE,
        level.initial_state.occupied.includes(element.id) ? 'placed' : 'unplaced'
      )
    }
    states.set(element.id, machine)
  }
  return states
}

/** Placed = participating. Levels without a construction model count everything as placed. */
export function isPlaced(states: ElementStates, elementId: string): boolean {
  const machine = states.get(elementId)
  if (!machine || !machine.has(PLACEMENT_STATE)) return true
  return machine.get(PLACEMENT_STATE) === 'placed'
}

/** Apply a declarative construction effect; no-op without a construction model. */
export function applyConstruction(
  states: ElementStates,
  elementId: string,
  effect: ConstructionEffect
): boolean {
  const machine = states.get(elementId)
  if (!machine || !machine.has(PLACEMENT_STATE)) return false
  const next = effect === 'place' ? 'placed' : 'unplaced'
  if (machine.get(PLACEMENT_STATE) === next) return false
  machine.set(PLACEMENT_STATE, next)
  return true
}

/**
 * Construction effects some role can perform ON THIS ARCHETYPE — the
 * solver's engine-playability gate, mirroring performAction exactly: the
 * role must can_perform the construction action AND its target_archetypes
 * must admit the element's archetype (an empty target_archetypes list
 * admits every archetype, as in performAction).
 */
export function constructionEffectsForArchetype(
  gameType: GameType,
  archetypeId: string
): Set<ConstructionEffect> {
  const effects = new Set<ConstructionEffect>()
  for (const capability of gameType.information_partition_template?.action_capability ?? []) {
    if (
      capability.target_archetypes.length > 0 &&
      !capability.target_archetypes.includes(archetypeId)
    ) {
      continue
    }
    for (const actionName of capability.can_perform) {
      const action = gameType.action_registry.find((entry) => entry.name === actionName)
      if (!action || !action.construction_effect || action.scope === 'rule_verb') continue
      effects.add(action.construction_effect)
    }
  }
  return effects
}

/**
 * Can some role drive action_event_mapping events on this archetype — i.e.
 * perform a player-performable action (scope != rule_verb) that DECLARES an
 * `action_type` param AND may target the archetype (target_archetypes; empty
 * list = all)? Mirrors performAction's event path exactly: only an action
 * declaring an action_type param may carry one, and actionEvent() maps that
 * value to a state_transition event. The action_type VALUE is a free string
 * (param_def declares no value domain), so any such action can produce any
 * mapping row's event — per-archetype granularity IS the engine's
 * reachability. The solver uses this to keep state_transition moves a subset
 * of engine reachability (no false-positive publishability).
 */
export function eventDrivableOnArchetype(gameType: GameType, archetypeId: string): boolean {
  for (const capability of gameType.information_partition_template?.action_capability ?? []) {
    if (
      capability.target_archetypes.length > 0 &&
      !capability.target_archetypes.includes(archetypeId)
    ) {
      continue
    }
    for (const actionName of capability.can_perform) {
      const action = gameType.action_registry.find((entry) => entry.name === actionName)
      if (
        action &&
        action.scope !== 'rule_verb' &&
        action.params.some((param) => param.name === 'action_type')
      ) {
        return true
      }
    }
  }
  return false
}

/** Does the performed action declare it fires this rule template (its `triggers`)? */
export function actionTriggers(
  action: GameType['action_registry'][number],
  templateId: string
): boolean {
  return action.triggers?.includes(templateId) ?? false
}

/**
 * Can some role fire this template ON THIS ARCHETYPE — i.e. perform a
 * player-performable action (scope != rule_verb) that BOTH triggers the
 * template (lists it in `triggers`) AND may target the archetype
 * (target_archetypes; empty list = all)? The trigger-gated counterpart of
 * eventDrivableOnArchetype, mirroring performAction + the engine's per-kind
 * trigger gate for temporal_sequence / condition_action / interaction_matrix:
 * such a rule fires only when a triggering action lands on one of its target
 * elements, so the solver keeps its move for the rule only when a real
 * (role, action, target) triple exists — solver reachability stays a subset
 * of engine reachability.
 */
export function templateTriggerableOnArchetype(
  gameType: GameType,
  templateId: string,
  archetypeId: string
): boolean {
  for (const capability of gameType.information_partition_template?.action_capability ?? []) {
    if (
      capability.target_archetypes.length > 0 &&
      !capability.target_archetypes.includes(archetypeId)
    ) {
      continue
    }
    for (const actionName of capability.can_perform) {
      const action = gameType.action_registry.find((entry) => entry.name === actionName)
      if (action && action.scope !== 'rule_verb' && actionTriggers(action, templateId)) return true
    }
  }
  return false
}

/**
 * Current score from interaction_matrix rules carrying relation_scores:
 * the sum over PLACED, pair-eligible target pairs' matrix relations.
 * undefined when the level has no scoring rule (no score concept).
 */
export function currentScore(ctx: RuleContext, states: ElementStates): number | undefined {
  let total: number | undefined
  for (const rule of ctx.level.rules) {
    const template = ctx.templates.get(rule.template)
    if (!template || template.type !== 'interaction_matrix') continue
    const scores = template.matrix_schema.relation_scores
    if (!scores) continue
    total = total ?? 0
    for (const pair of eligibleMatrixPairs(ctx, rule, template, states)) {
      total += scores[pair.relation] ?? 0
    }
  }
  return total
}

/**
 * remaining_steps (spec progress_measurability formula):
 * |empty_slots_with_both_pieces_available| — still-empty slots that could
 * receive a scoring pair, bounded by the pairs formable from the building
 * roles' unplaced pieces. The slot key is the matrix rule's first
 * pair_match attribute (data-driven). undefined without a construction
 * model or slot key. Spec worked example: 3 pairs placed → empty slots 5,
 * formable pairs 1 → remaining_steps 1.
 */
export function remainingSteps(ctx: RuleContext, states: ElementStates): number | undefined {
  const totalSlots = ctx.level.initial_state?.timeline_slots
  if (typeof totalSlots !== 'number') return undefined
  let slotKey: string | undefined
  for (const rule of ctx.level.rules) {
    const template = ctx.templates.get(rule.template)
    if (template?.type === 'interaction_matrix') {
      slotKey = template.matrix_schema.pair_match_attributes?.[0]
      if (slotKey) break
    }
  }
  if (!slotKey) return undefined
  const occupiedSlots = new Set<string>()
  for (const element of ctx.level.elements) {
    if (!isPlaced(states, element.id)) continue
    const slot = element.params[slotKey]
    if (slot !== undefined) occupiedSlots.add(String(slot))
  }
  const emptySlots = Math.max(totalSlots - occupiedSlots.size, 0)
  const capabilities = ctx.gameType.information_partition_template?.action_capability ?? []
  const unplacedCounts = capabilities.map(
    (capability) =>
      ctx.level.elements.filter((element) => {
        if (isPlaced(states, element.id)) return false
        return (
          capability.target_archetypes.length === 0 ||
          capability.target_archetypes.includes(element.archetype)
        )
      }).length
  )
  const formablePairs =
    unplacedCounts.length >= 2 ? Math.min(...unplacedCounts) : (unplacedCounts[0] ?? 0)
  return Math.min(emptySlots, formablePairs)
}

/** Declared value order of a state across the GameType (for ranked comparisons). */
function stateValueOrder(ctx: RuleContext, stateName: string): string[] | undefined {
  for (const archetype of ctx.gameType.element_archetypes) {
    const state = (archetype.states ?? []).find((s) => s.name === stateName)
    if (state?.values) return state.values
  }
  return undefined
}

/**
 * Win evaluation over runtime states. Implemented: all_solved,
 * score_threshold, and optimization_target (declarative constraints ranked
 * by each state's declared value order). Any unrecognized win type is false
 * here and rejected explicitly by the solvability check.
 */
export function evaluateWin(ctx: RuleContext, states: ElementStates): boolean {
  const win = ctx.level.win_condition
  if (win.type === 'all_solved') {
    const targetState = win.params.target_state
    const targets = Array.isArray(win.params.target_elements) ? win.params.target_elements : []
    if (typeof targetState !== 'string' || targets.length === 0) return false
    return (targets as unknown[]).every((targetId) => {
      if (typeof targetId !== 'string') return false
      const machine = states.get(targetId)
      if (!machine) return false
      return [...machine.entries()].some(
        ([key, value]) => key !== PLACEMENT_STATE && value === targetState
      )
    })
  }
  if (win.type === 'score_threshold') {
    const target = win.params.target_score
    if (typeof target !== 'number') return false
    const score = currentScore(ctx, states)
    return score !== undefined && score >= target
  }
  if (win.type === 'optimization_target') {
    return evaluateOptimizationTarget(ctx, states)
  }
  return false
}

function evaluateOptimizationTarget(ctx: RuleContext, states: ElementStates): boolean {
  const params = ctx.level.win_condition.params
  const atLeast = Array.isArray(params.all_states_at_least) ? params.all_states_at_least : []
  const countEqual = Array.isArray(params.count_states_equal) ? params.count_states_equal : []

  for (const raw of atLeast) {
    if (!isMappingValue(raw)) return false
    const stateName = raw.state
    const minValue = raw.value
    if (typeof stateName !== 'string' || typeof minValue !== 'string') return false
    const order = stateValueOrder(ctx, stateName)
    if (!order) return false
    const minRank = order.indexOf(minValue)
    // Every element that HAS this state must rank at least minValue.
    for (const machine of states.values()) {
      if (!machine.has(stateName)) continue
      const rank = order.indexOf(String(machine.get(stateName)))
      if (rank < minRank) return false
    }
  }

  for (const raw of countEqual) {
    if (!isMappingValue(raw)) return false
    const stateName = raw.state
    const value = raw.value
    const count = raw.count
    if (typeof stateName !== 'string' || typeof value !== 'string' || typeof count !== 'number') {
      return false
    }
    let matches = 0
    for (const machine of states.values()) {
      if (machine.get(stateName) === value) matches++
    }
    if (matches < count) return false
  }

  return atLeast.length > 0 || countEqual.length > 0
}

/**
 * Apply a declarative state effect to an element's FIRST declared state
 * machine. Unknown effect values are rejected (no-op) — G6: a typo can
 * never silently advance state.
 */
export function applyStateEffect(
  archetype: ElementArchetype,
  machine: Map<string, unknown>,
  effect: StateEffect | undefined
): boolean {
  if (effect !== 'advance_state' && effect !== 'complete_state') return false
  const primary = (archetype.states ?? [])[0]
  if (!primary || primary.type !== 'enum' || !primary.values || primary.values.length === 0) {
    return false
  }
  const current = machine.get(primary.name)
  const index = primary.values.indexOf(String(current))
  // Unknown CURRENT value (e.g. a typo'd GameType state initial) is rejected
  // as a no-op too — advance_state must never launder it into values[0], nor
  // complete_state into the terminal value (same G6 discipline as effects).
  if (index < 0) return false
  const lastIndex = primary.values.length - 1
  const nextIndex = effect === 'complete_state' ? lastIndex : Math.min(index + 1, lastIndex)
  if (index === nextIndex) return false
  machine.set(primary.name, primary.values[nextIndex])
  return true
}

/** Structural predicate evaluation: resolve each inlined param by name. */
export function evaluatePredicates(
  rule: LevelRule,
  archetype: ElementArchetype,
  params: Record<string, unknown>,
  machine: Map<string, unknown>
): boolean {
  const bindings = rule.bindings
  const entries = Array.isArray(bindings.predicates) ? bindings.predicates : []
  if (entries.length === 0) return false
  const attrNames = new Set(archetype.attributes.map((a) => a.name))
  const stateNamesSet = new Set((archetype.states ?? []).map((s) => s.name))
  const results: boolean[] = []
  for (const entry of entries) {
    if (!isMappingValue(entry)) return false
    const { name: _name, ...inlined } = entry
    let allResolved = true
    let allMatch = true
    for (const [paramName, expected] of Object.entries(inlined)) {
      let actual: unknown
      if (attrNames.has(paramName)) actual = params[paramName]
      else if (stateNamesSet.has(paramName)) actual = machine.get(paramName)
      else {
        // Semantic predicate param (e.g. plaintext_is_valid_word's
        // category): not machine-evaluable — the rule never auto-fires;
        // confirmation belongs to the human layer.
        allResolved = false
        break
      }
      if (String(actual) !== String(expected)) allMatch = false
    }
    if (!allResolved) return false
    results.push(allMatch)
  }
  const combinator = typeof bindings.combinator === 'string' ? bindings.combinator : 'AND'
  if (combinator === 'OR') return results.some(Boolean)
  if (combinator === 'NOT') return results.every((r) => !r)
  return results.every(Boolean)
}

/**
 * Events a player action can produce for the given rule template — the
 * spec-pinned `<rule_template_id>_event` column of action_event_mapping.
 */
export function producibleEvents(gameType: GameType, templateId: string): string[] {
  const events = new Set<string>()
  for (const row of gameType.action_event_mapping ?? []) {
    const event = row[`${templateId}_event`]
    if (typeof event === 'string') events.add(event)
  }
  return [...events]
}

/** The event a specific player action_type produces for a template, if any. */
export function actionEvent(
  gameType: GameType,
  templateId: string,
  actionType: string | undefined
): string | undefined {
  if (!actionType) return undefined
  const row = (gameType.action_event_mapping ?? []).find(
    (entry) => entry.action_type === actionType
  )
  const event = row?.[`${templateId}_event`]
  return typeof event === 'string' ? event : undefined
}

/** Execute one temporal_sequence step (bounded by max_steps per rule instance). */
export function executeTemporalStep(
  ctx: RuleContext,
  rule: LevelRule,
  template: Extract<RuleTemplate, { type: 'temporal_sequence' }>,
  states: ElementStates,
  stepsUsed: Map<string, number>
): boolean {
  const used = stepsUsed.get(rule.id) ?? 0
  if (used >= template.sequence_schema.max_steps) return false
  const stepAction = ctx.actions.get(template.sequence_schema.step_schema.action)
  let changed = false
  for (const targetId of rule.target_elements) {
    const target = ctx.elements.get(targetId)
    const archetype = target ? ctx.archetypes.get(target.archetype) : undefined
    const machine = states.get(targetId)
    if (!target || !archetype || !machine) continue
    if (applyStateEffect(archetype, machine, stepAction?.state_effect)) changed = true
  }
  stepsUsed.set(rule.id, used + 1)
  return changed
}

/** Fire a state_transition rule on one element under one event. */
export function executeStateTransition(
  rule: LevelRule,
  states: ElementStates,
  event: string,
  elementId: string
): boolean {
  const machine = states.get(elementId)
  if (!machine) return false
  const rows = Array.isArray(rule.bindings.transitions)
    ? (rule.bindings.transitions as unknown[])
    : []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) continue
    const [from, rowEvent, to] = row as [unknown, unknown, unknown]
    if (rowEvent !== event) continue
    const current = [...machine.entries()].find(([, value]) => value === from)
    if (current && typeof to === 'string') {
      machine.set(current[0], to)
      return true
    }
  }
  return false
}

/** Evaluate + fire a condition_action rule over its target elements. */
export function executeConditionAction(
  ctx: RuleContext,
  rule: LevelRule,
  states: ElementStates
): boolean {
  const actionBinding = rule.bindings.action
  const verb =
    isMappingValue(actionBinding) && typeof actionBinding.verb === 'string'
      ? actionBinding.verb
      : undefined
  const verbAction = verb ? ctx.actions.get(verb) : undefined
  let changed = false
  for (const targetId of rule.target_elements) {
    const target = ctx.elements.get(targetId)
    const archetype = target ? ctx.archetypes.get(target.archetype) : undefined
    const machine = states.get(targetId)
    if (!target || !archetype || !machine) continue
    if (!evaluatePredicates(rule, archetype, target.params, machine)) continue
    if (applyStateEffect(archetype, machine, verbAction?.state_effect)) changed = true
  }
  return changed
}

export interface MatrixPair {
  aId: string
  bId: string
  relation: string
}

/**
 * Unordered target pairs eligible for a matrix rule: both elements PLACED
 * (construction model honored; everything counts as placed without one),
 * passing the optional pair_match_attributes filter (equal values on every
 * named param — all pairs only when the filter is omitted), with a matching
 * matrix row. Shared by rule execution and score computation.
 */
export function eligibleMatrixPairs(
  ctx: RuleContext,
  rule: LevelRule,
  template: Extract<RuleTemplate, { type: 'interaction_matrix' }>,
  states: ElementStates
): MatrixPair[] {
  const rows = Array.isArray(rule.bindings.matrix) ? (rule.bindings.matrix as unknown[]) : []
  const attributes = template.matrix_schema.entity_type_attributes ?? []
  const pairMatch = template.matrix_schema.pair_match_attributes ?? []
  const entityTypeOf = (id: string): string | undefined => {
    const element = ctx.elements.get(id)
    if (!element) return undefined
    for (const attribute of attributes) {
      const value = element.params[attribute]
      if (typeof value === 'string') return value
    }
    return undefined
  }
  const pairEligible = (aId: string, bId: string): boolean => {
    if (pairMatch.length === 0) return true
    const a = ctx.elements.get(aId)
    const b = ctx.elements.get(bId)
    if (!a || !b) return false
    return pairMatch.every((name) => String(a.params[name]) === String(b.params[name]))
  }
  const pairs: MatrixPair[] = []
  for (const [i, aId] of rule.target_elements.entries()) {
    for (const bId of rule.target_elements.slice(i + 1)) {
      if (!isPlaced(states, aId) || !isPlaced(states, bId)) continue
      if (!pairEligible(aId, bId)) continue
      const aType = entityTypeOf(aId)
      const bType = entityTypeOf(bId)
      if (!aType || !bType) continue
      const row = rows.find(
        (r) =>
          Array.isArray(r) &&
          r.length === 3 &&
          ((r[0] === aType && r[1] === bType) || (r[0] === bType && r[1] === aType))
      ) as [string, string, string] | undefined
      if (!row) continue
      pairs.push({ aId, bId, relation: row[2] })
    }
  }
  return pairs
}

/**
 * Apply an interaction_matrix rule over its eligible pairs (see
 * eligibleMatrixPairs): the matched relation's effect action state_effect
 * applies to both pair members.
 */
export function executeInteractionMatrix(
  ctx: RuleContext,
  rule: LevelRule,
  template: Extract<RuleTemplate, { type: 'interaction_matrix' }>,
  states: ElementStates
): boolean {
  let changed = false
  for (const pair of eligibleMatrixPairs(ctx, rule, template, states)) {
    const effect = template.matrix_schema.effect_schema.find(
      (entry) => entry.relation === pair.relation
    )
    const effectAction = effect ? ctx.actions.get(effect.effect) : undefined
    for (const memberId of [pair.aId, pair.bId]) {
      const member = ctx.elements.get(memberId)
      const archetype = member ? ctx.archetypes.get(member.archetype) : undefined
      const machine = states.get(memberId)
      if (!member || !archetype || !machine) continue
      if (applyStateEffect(archetype, machine, effectAction?.state_effect)) changed = true
    }
  }
  return changed
}
