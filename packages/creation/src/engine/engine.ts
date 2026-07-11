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

import type { GameType, Level } from '../schema/types'
import { elementsById, expandNames, forbiddenFieldsForRole, WILDCARD } from '../validate/helpers'
import type { ElementStates, RuleContext } from './rules'
import {
  actionEvent,
  actionTriggers,
  applyConstruction,
  buildRuleContext,
  currentScore,
  emitterTargetElementIds,
  evaluateLose,
  evaluateWin,
  executeConditionAction,
  isElementTerminallyLost,
  executeInteractionMatrix,
  executeStateTransition,
  executeTemporalStep,
  initialElementStates,
  remainingSteps,
} from './rules'

export interface EngineSnapshot {
  elements: Record<string, Record<string, unknown>>
  /**
   * The RESOLVED win flag: true only when the win condition is met AND the run
   * is not lost. Encodes the "lose wins ties" precedence (a corpse never shows
   * a win), so a host can render this directly. The raw predicates isWon() /
   * isLost() stay independent (both can be true in a tie).
   */
  won: boolean
  /** True when the lose condition is met (raw predicate). */
  lost: boolean
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

/**
 * One (emitter, element) result of an advanceTime call — emitted only when the
 * accumulated charge crossed the interval this advance. `fired` is whether a
 * matching state_transition row actually changed state (false = the event was
 * inert on the element, e.g. no consuming rule — the case the validator's
 * emitter_target_reaches_terminal check prevents shipping).
 */
export interface TimedTick {
  elementId: string
  emitterId: string
  event: string
  fired: boolean
}

/** Per-(emitter, element) countdown for the pre-decay warning UI (pure read). */
export interface TimerStatus {
  elementId: string
  emitterId: string
  /** Milliseconds until the next tick (0 when due); never negative. */
  msUntilTick: number
  /** True once msUntilTick <= the emitter's warning_lead_ms. */
  warning: boolean
}

/**
 * One resolved (emitter, element) timer. `charge` is the only mutable field;
 * `interval` folds in any per-instance initial_timers.interval_ms override,
 * `warningLead` comes from the emitter (initial_timers carries no lead field).
 */
interface TimerEntry {
  emitterId: string
  event: string
  targetTemplate: string
  elementId: string
  interval: number
  warningLead: number
  charge: number
}

export interface PerformActionArgs {
  element_id?: string
  /** Param value driving action_event_mapping rows (e.g. apply_care's action_type). */
  action_type?: string
  /**
   * Any further arg must be a param the action DECLARES in its
   * action_registry param_defs (e.g. sound-garden place_piece's `slot`).
   * Declared params other than action_type are accepted as call payload but
   * carry no engine semantics (placement reads the element's own params);
   * undeclared keys are rejected as malformed.
   */
  [param: string]: unknown
}

/**
 * A live game session over one (GameType, Level) pair. R5's dev UI drives
 * this API: getRoleView per player, performAction on interactions, isWon.
 */
export class GameSession {
  private readonly ctx: RuleContext
  private readonly states: ElementStates
  private readonly stepsUsed = new Map<string, number>()
  /** Resolved (emitter, element) timers; empty when no timed_emitters. */
  private readonly timers: TimerEntry[]

  constructor(gameType: GameType, level: Level) {
    this.ctx = buildRuleContext(gameType, level)
    this.states = initialElementStates(gameType, level)
    this.timers = this.buildTimers()
  }

  /**
   * Resolve one TimerEntry per (emitter, targeted element), folding in
   * per-instance initial_timers overrides. Initial charge = offset_ms (phase).
   * Deterministic order (emitter order × resolved element order).
   */
  private buildTimers(): TimerEntry[] {
    const timers: TimerEntry[] = []
    for (const emitter of this.ctx.gameType.timed_emitters ?? []) {
      const warningLead = emitter.warning_lead_ms ?? 0
      for (const elementId of emitterTargetElementIds(this.ctx.level, emitter)) {
        const override = this.ctx.elements.get(elementId)?.initial_timers?.[emitter.id]
        const interval =
          typeof override?.interval_ms === 'number' ? override.interval_ms : emitter.interval_ms
        const offset = typeof override?.offset_ms === 'number' ? override.offset_ms : 0
        timers.push({
          emitterId: emitter.id,
          event: emitter.event,
          targetTemplate: emitter.target_template,
          elementId,
          interval,
          warningLead,
          charge: offset,
        })
      }
    }
    return timers
  }

  getState(): EngineSnapshot {
    const elements: Record<string, Record<string, unknown>> = {}
    for (const [elementId, machine] of this.states) {
      elements[elementId] = Object.fromEntries(machine)
    }
    const lost = this.isLost()
    // Tie-break: lose wins ties — a dead plant never shows a win.
    return { elements, won: this.isWon() && !lost, lost }
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
    // Shared cannot_see subtraction — the same helper the validator's
    // visibility model uses, so runtime and validator can never diverge.
    const forbidden = forbiddenFieldsForRole(gameType, roleId)

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

    // Arg validation honors the action's DECLARED param_defs: element_id and
    // every declared param are legal call args; anything else is malformed.
    // Distinguish a malformed call from a legitimate no-op, and keep
    // action_type NON-FORGEABLE (B part 2): a MEANINGFUL action_type is
    // honored only on an action that actually DECLARES an action_type param
    // — it can never be smuggled onto an unrelated action to claim an effect
    // that action does not have. An empty/absent action_type is "not provided"
    // (a no-op), not a forgery. Declared params other than action_type (e.g.
    // sound-garden place_piece's slot) are accepted but engine-inert — only
    // action_type is machine-consumed (it drives action_event_mapping).
    const declaredParams = new Set(action.params.map((param) => param.name))
    const declaresActionType = declaredParams.has('action_type')
    const providedActionType = args.action_type === '' ? undefined : args.action_type
    for (const [key, value] of Object.entries(args)) {
      if (key === 'element_id' || declaredParams.has(key)) continue
      if (key === 'action_type' && (value === undefined || value === '')) continue
      return {
        ok: false,
        reason:
          key === 'action_type'
            ? `action "${actionName}" does not declare an action_type`
            : `unknown arg "${key}" for action "${actionName}"`,
      }
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

  /** Failure-mode mirror of isWon (raw predicate; independent of isWon). */
  isLost(): boolean {
    return evaluateLose(this.ctx, this.states)
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
   * Advance simulated time by `dtMs`, firing any (emitter, element) whose
   * accumulated charge crosses its interval. Deterministic: reads NO
   * wall-clock, so the same call sequence yields the same result. Each
   * (emitter, element) fires AT MOST ONCE per call — the documented
   * once-per-advance tick cap (a large dt spanning many intervals still fires
   * once and does NOT accumulate residual charge; charge is capped at
   * interval). Returns one TimedTick per crossing for the host to render.
   *
   * Contracts (manager-pinned):
   * - non-finite or negative dtMs → THROW (a host bug; fail loud).
   * - dtMs === 0 → no-op (zero elapsed time changes nothing; idempotent).
   * - after the run has ended (isWon OR isLost) → no-op freeze (timers stop;
   *   timerStatus stays readable). The tick during which death occurs is fully
   *   processed — isLost is false at its start — and only subsequent calls
   *   freeze, so the run ends the instant a plant hits its terminal state.
   */
  advanceTime(dtMs: number): TimedTick[] {
    if (!Number.isFinite(dtMs) || dtMs < 0) {
      throw new RangeError(`advanceTime requires a finite dtMs >= 0, got ${dtMs}`)
    }
    if (dtMs === 0) return []
    if (this.isWon() || this.isLost()) return []
    const ticks: TimedTick[] = []
    for (const timer of this.timers) {
      timer.charge = Math.min(timer.charge + dtMs, timer.interval)
      if (timer.charge < timer.interval) continue
      const fired = this.fireEmitterEvent(timer.elementId, timer.targetTemplate, timer.event)
      timer.charge = 0
      ticks.push({
        elementId: timer.elementId,
        emitterId: timer.emitterId,
        event: timer.event,
        fired,
      })
    }
    return ticks
  }

  /**
   * Per-(emitter, element) countdown for the warning UI. Pure read: never
   * advances charge, always readable (including after the run ends).
   */
  timerStatus(): TimerStatus[] {
    return this.timers.map((timer) => {
      const msUntilTick = Math.max(0, timer.interval - timer.charge)
      return {
        elementId: timer.elementId,
        emitterId: timer.emitterId,
        msUntilTick,
        warning: msUntilTick <= timer.warningLead,
      }
    })
  }

  /**
   * Fire one emitter event on every level rule of `targetTemplate` targeting
   * the element, through the SAME executeStateTransition core a player-driven
   * event uses. Returns whether any rule actually changed state.
   */
  private fireEmitterEvent(elementId: string, targetTemplate: string, event: string): boolean {
    // A terminally-lost element never transitions out (mirrors the player-event
    // guard); the advanceTime freeze makes this unreachable in practice, but it
    // keeps the terminal-is-irreversible contract total across both callers.
    if (isElementTerminallyLost(this.ctx, this.states, elementId)) return false
    let changed = false
    for (const rule of this.ctx.level.rules) {
      if (rule.template !== targetTemplate) continue
      if (!rule.target_elements.includes(elementId)) continue
      const template = this.ctx.templates.get(rule.template)
      if (!template || template.type !== 'state_transition') continue
      if (executeStateTransition(rule, this.states, event, elementId)) changed = true
    }
    return changed
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
        // Dead is terminal on the transition path too: a lost element never
        // transitions out (blocks a `[dead, correct_care, wilting]` revival via
        // performAction, which isLost does not freeze). Mirrors the
        // applyStateEffect resurrection guard.
        if (
          event &&
          !isElementTerminallyLost(this.ctx, this.states, elementId) &&
          executeStateTransition(rule, this.states, event, elementId)
        ) {
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
