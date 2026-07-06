/**
 * Minimal declarative rule engine session (spec Mechanism 1 semantics, R4).
 *
 * GameSession loads a (GameType, Level) pair into runtime state, accepts
 * player actions, and determines the win condition — executing every rule
 * through the SHARED core in rules.ts (the single semantics source also
 * used by the solver). Zero game-specific logic: all case differences flow
 * from vocabulary data.
 *
 * The engine mutates only its own runtime state — never the Level or
 * GameType inputs.
 */

import type { ElementArchetype, GameType, Level } from '../schema/types'
import { elementsById, expandNames, WILDCARD } from '../validate/helpers'
import type { ElementStates, RuleContext } from './rules'
import {
  actionEvent,
  actionTriggers,
  applyConstruction,
  buildRuleContext,
  currentScore,
  evaluateWin,
  executeConditionAction,
  executeInteractionMatrix,
  executeStateTransition,
  executeTemporalStep,
  initialElementStates,
  remainingSteps,
} from './rules'

export interface EngineSnapshot {
  elements: Record<string, Record<string, unknown>>
  won: boolean
}

export interface RoleElementView {
  element_id: string
  archetype: string
  visible_params: Record<string, unknown>
  visible_states: Record<string, unknown>
}

export interface RoleView {
  role: string
  elements: RoleElementView[]
  /** Rule ids whose template this role may see (rule_visibility). */
  visible_rules: string[]
  /** Action names this role can perform (action_capability). */
  can_perform: string[]
}

export type ActionResult = { ok: true; effects: string[] } | { ok: false; reason: string }

export interface PerformActionArgs {
  element_id?: string
  /** Param value driving action_event_mapping rows (e.g. apply_care's action_type). */
  action_type?: string
}

/**
 * A live game session over one (GameType, Level) pair. R5's dev UI drives
 * this API: getRoleView per player, performAction on interactions, isWon.
 */
export class GameSession {
  private readonly ctx: RuleContext
  private readonly states: ElementStates
  private readonly stepsUsed = new Map<string, number>()

  constructor(gameType: GameType, level: Level) {
    this.ctx = buildRuleContext(gameType, level)
    this.states = initialElementStates(gameType, level)
  }

  getState(): EngineSnapshot {
    const elements: Record<string, Record<string, unknown>> = {}
    for (const [elementId, machine] of this.states) {
      elements[elementId] = Object.fromEntries(machine)
    }
    return { elements, won: this.isWon() }
  }

  /**
   * Partition-filtered view for one role: starts from the level's
   * element_views ("*" expanded) and additionally EXCLUDES every field the
   * GameType template declares cannot_see for the role — a leaked field can
   * never appear even if a level view over-declares.
   */
  getRoleView(roleId: string): RoleView {
    const { gameType, level, archetypes } = this.ctx
    const elements = elementsById(level)
    const template = gameType.information_partition_template
    const forbidden = new Map<string, { attributes: Set<string>; states: Set<string> }>()
    const visibilityRule = template?.visibility_rules.find((entry) => entry.role === roleId)
    for (const entry of visibilityRule?.cannot_see ?? []) {
      const matched =
        entry.element_archetype === WILDCARD
          ? [...archetypes.values()]
          : [archetypes.get(entry.element_archetype)].filter(
              (a): a is ElementArchetype => a !== undefined
            )
      for (const archetype of matched) {
        const bucket = forbidden.get(archetype.id) ?? {
          attributes: new Set<string>(),
          states: new Set<string>(),
        }
        for (const attr of expandNames(
          entry.attributes,
          archetype.attributes.map((a) => a.name)
        )) {
          bucket.attributes.add(attr)
        }
        for (const state of expandNames(
          entry.states,
          (archetype.states ?? []).map((s) => s.name)
        )) {
          bucket.states.add(state)
        }
        forbidden.set(archetype.id, bucket)
      }
    }

    const assignment = level.information_partition.role_assignments.find((a) => a.role === roleId)
    const views: RoleElementView[] = []
    for (const view of assignment?.element_views ?? []) {
      const element = elements.get(view.element_id)
      const archetype = element ? archetypes.get(element.archetype) : undefined
      if (!element || !archetype) continue
      const bucket = forbidden.get(archetype.id)
      const visibleAttrs = expandNames(
        view.visible_attributes,
        archetype.attributes.map((a) => a.name)
      ).filter((attr) => !bucket?.attributes.has(attr))
      const visibleStates = expandNames(
        view.visible_states,
        (archetype.states ?? []).map((s) => s.name)
      ).filter((state) => !bucket?.states.has(state))
      const machine = this.states.get(element.id) ?? new Map<string, unknown>()
      views.push({
        element_id: element.id,
        archetype: element.archetype,
        visible_params: Object.fromEntries(
          visibleAttrs
            .filter((attr) => element.params[attr] !== undefined)
            .map((attr) => [attr, element.params[attr]])
        ),
        visible_states: Object.fromEntries(
          visibleStates.filter((s) => machine.has(s)).map((s) => [s, machine.get(s)])
        ),
      })
    }

    const ruleEntry = template?.rule_visibility.find((entry) => entry.role === roleId)
    const visibleTemplates = ruleEntry?.visible_rule_templates ?? []
    const visibleRules = level.rules
      .filter((rule) => {
        if (visibleTemplates.includes(WILDCARD)) return this.ctx.templates.has(rule.template)
        return visibleTemplates.includes(rule.template)
      })
      .map((rule) => rule.id)
    const capability = template?.action_capability.find((entry) => entry.role === roleId)

    return {
      role: roleId,
      elements: views,
      visible_rules: visibleRules,
      can_perform: capability?.can_perform ?? [],
    }
  }

  performAction(roleId: string, actionName: string, args: PerformActionArgs = {}): ActionResult {
    const action = this.ctx.actions.get(actionName)
    if (!action) return { ok: false, reason: `unknown action "${actionName}"` }
    if (action.scope === 'rule_verb') {
      return { ok: false, reason: `"${actionName}" is engine-internal (scope rule_verb)` }
    }
    const capability = this.ctx.gameType.information_partition_template?.action_capability.find(
      (entry) => entry.role === roleId
    )
    if (!capability || !capability.can_perform.includes(actionName)) {
      return { ok: false, reason: `role "${roleId}" cannot perform "${actionName}"` }
    }

    // Arg validation. Distinguish a malformed call from a legitimate no-op,
    // and keep action_type NON-FORGEABLE (B part 2): a MEANINGFUL action_type
    // is honored only on an action that actually DECLARES an action_type param
    // — it can never be smuggled onto an unrelated action to claim an effect
    // that action does not have. An empty/absent action_type is "not provided"
    // (a no-op), not a forgery. An unknown arg key, a missing declared
    // action_type, and a construction action with no target are all malformed.
    const declaresActionType = action.params.some((param) => param.name === 'action_type')
    const providedActionType = args.action_type === '' ? undefined : args.action_type
    for (const key of Object.keys(args)) {
      if (key === 'element_id' || key === 'action_type') continue
      return { ok: false, reason: `unknown arg "${key}" for action "${actionName}"` }
    }
    if (providedActionType !== undefined && !declaresActionType) {
      return { ok: false, reason: `action "${actionName}" does not declare an action_type` }
    }
    if (declaresActionType && providedActionType === undefined) {
      return { ok: false, reason: `action "${actionName}" requires an action_type param` }
    }
    if (action.construction_effect && args.element_id === undefined) {
      return { ok: false, reason: `action "${actionName}" requires a target element` }
    }

    const effects: string[] = []
    if (args.element_id !== undefined) {
      const element = this.ctx.elements.get(args.element_id)
      if (!element) return { ok: false, reason: `unknown element "${args.element_id}"` }
      if (
        capability.target_archetypes.length > 0 &&
        !capability.target_archetypes.includes(element.archetype)
      ) {
        return {
          ok: false,
          reason: `role "${roleId}" cannot act on archetype "${element.archetype}"`,
        }
      }
      if (
        action.construction_effect &&
        applyConstruction(this.states, args.element_id, action.construction_effect)
      ) {
        effects.push(`${actionName}: ${args.element_id} ${action.construction_effect}d`)
      }
      effects.push(...this.evaluateRulesFor(args.element_id, action, providedActionType))
    }
    return { ok: true, effects }
  }

  isWon(): boolean {
    return evaluateWin(this.ctx, this.states)
  }

  /** Current score (score_threshold levels); undefined without a scoring rule. */
  score(): number | undefined {
    return currentScore(this.ctx, this.states)
  }

  /** Spec remaining-steps metric; undefined without a construction/slot model. */
  remainingSteps(): number | undefined {
    return remainingSteps(this.ctx, this.states)
  }

  /**
   * Evaluate every rule targeting the element through the shared core, gated
   * on the action actually performed. state_transition fires under the
   * action_event_mapping event; temporal_sequence / condition_action /
   * interaction_matrix fire only when the performed action declares the rule's
   * template in its `triggers` — a pure-communication action never advances
   * game state (B: rule firing depends on WHICH action triggered it).
   */
  private evaluateRulesFor(
    elementId: string,
    action: GameType['action_registry'][number],
    actionType: string | undefined
  ): string[] {
    const effects: string[] = []
    for (const rule of this.ctx.level.rules) {
      if (!rule.target_elements.includes(elementId)) continue
      const template = this.ctx.templates.get(rule.template)
      if (!template) continue
      if (template.type === 'state_transition') {
        const event = actionEvent(this.ctx.gameType, template.id, actionType)
        if (event && executeStateTransition(rule, this.states, event, elementId)) {
          effects.push(`${rule.id}: event ${event}`)
        }
        continue
      }
      if (!actionTriggers(action, template.id)) continue
      if (template.type === 'temporal_sequence') {
        if (executeTemporalStep(this.ctx, rule, template, this.states, this.stepsUsed)) {
          effects.push(`${rule.id}: step applied`)
        }
      } else if (template.type === 'condition_action') {
        if (executeConditionAction(this.ctx, rule, this.states)) {
          effects.push(`${rule.id}: fired`)
        }
      } else if (executeInteractionMatrix(this.ctx, rule, template, this.states)) {
        effects.push(`${rule.id}: matrix applied`)
      }
    }
    return effects
  }
}
