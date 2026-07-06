/**
 * Framework-free wiring between the dev shell UI and a GameSession. All
 * game knowledge flows from vocabulary data + the session API — the store
 * adds only presentation conveniences (log, labels, restart). Kept free of
 * React so the wiring is testable in plain Node.
 */

import type { ActionResult, RoleView } from '../src/engine/engine'
import { GameSession } from '../src/engine/engine'
import { PLACEMENT_STATE } from '../src/engine/rules'
import type { ActionDefinition, GameType, Level, LevelRule } from '../src/schema/types'

export interface LogEntry {
  seq: number
  role: string
  summary: string
  ok: boolean
  detail: string
}

export interface RuleSummary {
  id: string
  template: string
  bindings: string
}

export class DevShellStore {
  private session: GameSession
  private entries: LogEntry[] = []
  private seq = 0

  constructor(
    private readonly gameType: GameType,
    private readonly level: Level
  ) {
    this.session = new GameSession(gameType, level)
  }

  title(): string {
    return `${this.gameType.display_name} · ${this.level.metadata.title} (${this.level.metadata.id})`
  }

  roleIds(): string[] {
    return (this.gameType.information_partition_template?.roles ?? []).map((role) => role.id)
  }

  roleLabel(roleId: string): string {
    const role = this.gameType.information_partition_template?.roles.find((r) => r.id === roleId)
    return role ? `${role.display_name} (${role.id})` : roleId
  }

  view(roleId: string): RoleView {
    return this.session.getRoleView(roleId)
  }

  /**
   * Audio placeholder only when the CONTENT is auditory AND the viewing
   * role perceives it aurally (input_modality) — a visual builder looking
   * at a shared timeline needs no placeholder (R5 verify note applied).
   */
  audioPlaceholder(roleId: string, archetypeId: string): boolean {
    const category = this.gameType.element_archetypes.find((a) => a.id === archetypeId)?.category
    const modality = this.gameType.information_partition_template?.roles.find(
      (r) => r.id === roleId
    )?.input_modality
    return category === 'auditory' && modality === 'auditory'
  }

  /** Current score vs target for score_threshold levels; undefined otherwise. */
  score(): { current: number; target: number } | undefined {
    const current = this.session.score()
    const target = this.level.win_condition.params.target_score
    if (current === undefined || typeof target !== 'number') return undefined
    return { current, target }
  }

  /** Placement state under the co_build construction model; undefined without one. */
  placementOf(elementId: string): string | undefined {
    const value = this.session.getState().elements[elementId]?.[PLACEMENT_STATE]
    return typeof value === 'string' ? value : undefined
  }

  /** Registry definitions for a role's performable actions (param metadata). */
  actionsFor(roleId: string): ActionDefinition[] {
    const names = this.view(roleId).can_perform
    return this.gameType.action_registry.filter((action) => names.includes(action.name))
  }

  /**
   * Elements this role may act on — its visible elements filtered by the
   * role's action_capability.target_archetypes (empty = all). Mirrors the
   * engine's performAction gate so the shell only offers targets the engine
   * will accept (F6).
   */
  targetableElements(roleId: string): { element_id: string; archetype: string }[] {
    const capability = this.gameType.information_partition_template?.action_capability.find(
      (entry) => entry.role === roleId
    )
    const targets = capability?.target_archetypes ?? []
    return this.view(roleId).elements.filter(
      (element) => targets.length === 0 || targets.includes(element.archetype)
    )
  }

  /** Codebook entries for the rule ids a role may see. */
  ruleSummaries(ruleIds: string[]): RuleSummary[] {
    return this.level.rules
      .filter((rule): rule is LevelRule => ruleIds.includes(rule.id))
      .map((rule) => ({
        id: rule.id,
        template: rule.template,
        bindings: JSON.stringify(rule.bindings),
      }))
  }

  hasEventMapping(): boolean {
    return (this.gameType.action_event_mapping ?? []).length > 0
  }

  stateOf(elementId: string): Record<string, unknown> {
    return this.session.getState().elements[elementId] ?? {}
  }

  won(): boolean {
    return this.session.isWon()
  }

  log(): readonly LogEntry[] {
    return this.entries
  }

  perform(
    roleId: string,
    actionName: string,
    args: { element_id?: string; action_type?: string }
  ): ActionResult {
    const result = this.session.performAction(roleId, actionName, args)
    this.seq += 1
    const target = args.element_id ? ` → ${args.element_id}` : ''
    this.entries = [
      {
        seq: this.seq,
        role: roleId,
        summary: `${actionName}${target}`,
        ok: result.ok,
        detail: result.ok
          ? result.effects.length > 0
            ? result.effects.join('; ')
            : 'no effect'
          : result.reason,
      },
      ...this.entries,
    ]
    return result
  }

  reset(): void {
    this.session = new GameSession(this.gameType, this.level)
    this.entries = []
    this.seq = 0
  }
}
