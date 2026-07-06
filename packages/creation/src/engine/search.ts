/**
 * Engine-backed bounded solution search (spec solvability contract).
 *
 * searchSolution: BFS over rule executions AND construction moves from the
 * Level's initial state — every move executes through the SHARED core in
 * rules.ts (the same semantics the live GameSession plays), so the solver
 * can never report solvable for a level the engine cannot play.
 * state_transition moves are EVENT-GATED (only action_event_mapping
 * producible events, and only on elements whose archetype some role can
 * target with an action_type-declaring action — the engine's sole event
 * path); construction moves are CAPABILITY-GATED PER ELEMENT
 * ARCHETYPE — a place/remove move exists only when some role both
 * can_perform the construction action AND may target the element's
 * archetype (target_archetypes; empty list admits all), exactly mirroring
 * performAction. States deduplicate by hash; the shared solver_timeout_ms
 * deadline bounds the search.
 *
 * solutionDriversForTarget: the uniqueness primitive — which rules can,
 * executed ALONE from the initial state, drive one win target to the target
 * state. Returns an explicit timedOut flag so an interrupted analysis is
 * never mistaken for a clean count (G3).
 */

import type { GameType, Level, LevelRule, RuleTemplate } from '../schema/types'
import type { Deadline } from '../validate/helpers'
import { startDeadline } from '../validate/helpers'
import type { ElementStates, RuleContext } from './rules'
import {
  applyConstruction,
  buildRuleContext,
  constructionEffectsForArchetype,
  evaluateWin,
  eventDrivableOnArchetype,
  executeConditionAction,
  executeInteractionMatrix,
  executeStateTransition,
  executeTemporalStep,
  initialElementStates,
  isPlaced,
  producibleEvents,
  templateTriggerableOnArchetype,
} from './rules'

export interface SolutionSearchResult {
  solvable: boolean
  /** Rule ids in execution order (empty when unsolvable or timed out). */
  path: string[]
  timedOut: boolean
}

export interface SolutionDrivers {
  drivers: LevelRule[]
  /** True when the deadline interrupted the analysis — the count is partial. */
  timedOut: boolean
}

interface SearchNode {
  states: ElementStates
  stepsUsed: Map<string, number>
  path: string[]
}

type MoveFn = (states: ElementStates, stepsUsed: Map<string, number>) => boolean

function cloneStates(states: ElementStates): ElementStates {
  return new Map([...states].map(([id, machine]) => [id, new Map(machine)]))
}

function hashNode(states: ElementStates, stepsUsed: Map<string, number>): string {
  const stateEntries = [...states].map(([id, machine]) => [id, [...machine].sort()] as const).sort()
  const stepEntries = [...stepsUsed].sort()
  return JSON.stringify([stateEntries, stepEntries])
}

/** Can some role drive mapping events on this element (mirrors performAction)? */
function targetEventDrivable(ctx: RuleContext, elementId: string): boolean {
  const archetype = ctx.elements.get(elementId)?.archetype
  return archetype !== undefined && eventDrivableOnArchetype(ctx.gameType, archetype)
}

/** Can some role fire this template on the element's archetype (trigger gate)? */
function targetTriggerable(ctx: RuleContext, templateId: string, elementId: string): boolean {
  const archetype = ctx.elements.get(elementId)?.archetype
  return (
    archetype !== undefined && templateTriggerableOnArchetype(ctx.gameType, templateId, archetype)
  )
}

/**
 * All legal moves a rule contributes, through the shared execution core.
 * Rule moves are gated exactly as the live engine fires them (keeping solver
 * reachability ⊆ engine reachability):
 * - state_transition: EVENT-gated (no producible action_event_mapping row →
 *   no move) AND event-drivable per element — the move acts on one element,
 *   so some role must be able to perform an action_type-declaring action on
 *   that element's archetype (the engine's only path to a mapping event).
 * - temporal_sequence / condition_action / interaction_matrix: TRIGGER-gated —
 *   they fire only when a player action that lists this template in its
 *   `triggers` lands on one of the rule's target elements, so the move is
 *   emitted iff at least one target's archetype is triggerable by some role.
 */
function movesForRule(ctx: RuleContext, rule: LevelRule, template: RuleTemplate): MoveFn[] {
  switch (template.type) {
    case 'temporal_sequence':
      if (!rule.target_elements.some((id) => targetTriggerable(ctx, template.id, id))) return []
      return [(states, stepsUsed) => executeTemporalStep(ctx, rule, template, states, stepsUsed)]
    case 'state_transition': {
      const moves: MoveFn[] = []
      for (const event of producibleEvents(ctx.gameType, template.id)) {
        for (const elementId of rule.target_elements) {
          if (!targetEventDrivable(ctx, elementId)) continue
          moves.push((states) => executeStateTransition(rule, states, event, elementId))
        }
      }
      return moves
    }
    case 'condition_action':
      if (!rule.target_elements.some((id) => targetTriggerable(ctx, template.id, id))) return []
      return [(states) => executeConditionAction(ctx, rule, states)]
    case 'interaction_matrix':
      if (!rule.target_elements.some((id) => targetTriggerable(ctx, template.id, id))) return []
      return [(states) => executeInteractionMatrix(ctx, rule, template, states)]
  }
}

/**
 * Construction moves (co_build): place/remove each element, gated PER
 * ELEMENT on a role that can perform the construction action AND may target
 * the element's archetype — mirroring performAction exactly, so the solver
 * never builds what no role can play (same engine-playability principle as
 * event gating).
 */
function constructionMoves(
  ctx: RuleContext,
  node: SearchNode
): Array<{ id: string; move: MoveFn }> {
  if (!ctx.level.initial_state) return []
  const moves: Array<{ id: string; move: MoveFn }> = []
  for (const element of ctx.level.elements) {
    const effects = constructionEffectsForArchetype(ctx.gameType, element.archetype)
    if (effects.has('place') && !isPlaced(node.states, element.id)) {
      moves.push({
        id: `place:${element.id}`,
        move: (states) => applyConstruction(states, element.id, 'place'),
      })
    }
    if (effects.has('remove') && isPlaced(node.states, element.id)) {
      moves.push({
        id: `remove:${element.id}`,
        move: (states) => applyConstruction(states, element.id, 'remove'),
      })
    }
  }
  return moves
}

/**
 * Bounded BFS over rule executions and construction moves; returns a
 * solution path when found. Path entries are rule ids or construction move
 * ids ("place:<elementId>" / "remove:<elementId>").
 */
export function searchSolution(
  gameType: GameType,
  level: Level,
  deadline: Deadline = startDeadline(gameType.solver_timeout_ms)
): SolutionSearchResult {
  const ctx = buildRuleContext(gameType, level)
  const initial: SearchNode = {
    states: initialElementStates(gameType, level),
    stepsUsed: new Map(),
    path: [],
  }
  if (evaluateWin(ctx, initial.states)) return { solvable: true, path: [], timedOut: false }

  const queue: SearchNode[] = [initial]
  const visited = new Set<string>([hashNode(initial.states, initial.stepsUsed)])

  while (queue.length > 0) {
    if (deadline.timedOut()) return { solvable: false, path: [], timedOut: true }
    const node = queue.shift() as SearchNode
    const moves: Array<{ id: string; move: MoveFn }> = constructionMoves(ctx, node)
    for (const rule of level.rules) {
      const template = ctx.templates.get(rule.template)
      if (!template) continue
      for (const move of movesForRule(ctx, rule, template)) {
        moves.push({ id: rule.id, move })
      }
    }
    for (const { id, move } of moves) {
      const states = cloneStates(node.states)
      const stepsUsed = new Map(node.stepsUsed)
      if (!move(states, stepsUsed)) continue
      const hash = hashNode(states, stepsUsed)
      if (visited.has(hash)) continue
      visited.add(hash)
      const path = [...node.path, id]
      if (evaluateWin(ctx, states)) return { solvable: true, path, timedOut: false }
      queue.push({ states, stepsUsed, path })
    }
  }
  return { solvable: false, path: [], timedOut: false }
}

/**
 * Rules that, executed alone from the initial state, drive the given win
 * target to the win-condition target state (bounded repeated application
 * through the shared core).
 */
export function solutionDriversForTarget(
  gameType: GameType,
  level: Level,
  targetId: string,
  deadline: Deadline
): SolutionDrivers {
  const ctx = buildRuleContext(gameType, level)
  const targetState = level.win_condition.params.target_state
  if (typeof targetState !== 'string') return { drivers: [], timedOut: false }
  const drivers: LevelRule[] = []
  for (const rule of level.rules) {
    if (deadline.timedOut()) return { drivers, timedOut: true }
    if (!rule.target_elements.includes(targetId)) continue
    const template = ctx.templates.get(rule.template)
    if (!template) continue
    const states = initialElementStates(gameType, level)
    const stepsUsed = new Map<string, number>()
    const moves = movesForRule(ctx, rule, template)
    const bound = boundFor(template)
    let reached = false
    for (let i = 0; i < bound && !reached; i++) {
      const changed = moves.some((move) => move(states, stepsUsed))
      if (!changed) break
      const machine = states.get(targetId)
      reached = !!machine && [...machine.values()].some((value) => value === targetState)
    }
    if (reached) drivers.push(rule)
  }
  return { drivers, timedOut: false }
}

function boundFor(template: RuleTemplate): number {
  if (template.type === 'temporal_sequence') return template.sequence_schema.max_steps
  if (template.type === 'state_transition') {
    return template.transition_table_schema.states.length + 1
  }
  return 4
}
