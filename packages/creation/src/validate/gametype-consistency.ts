/**
 * gametype_consistency — the registration-time gate over a GameType's
 * internal referential integrity (spec Mechanism 3). Housed as its own entry
 * (validateGameType) rather than inside validateLevel: the spec pins this
 * check to GameType registration/update time, and every Level-scoped check
 * (universal + floor) assumes the GameType already passed it.
 *
 * Checks: rule-template action references resolve in action_registry with a
 * compatible scope; partition template roles/archetypes/attributes/actions
 * all resolve ("*" wildcards legal where the spec allows them); and every
 * shared_label_attributes attribute is visible (can_see) to every
 * communicating role — the structural guarantee behind cross-role
 * co-reference.
 */

import type {
  ActionScope,
  CheckResult,
  ElementArchetype,
  GameType,
  Violation,
} from '../schema/types'
import { PARTITION_REQUIRED_CO_PLAY_FORMS } from '../schema/types'
import {
  archetypesById,
  attributeNames,
  buildCheckResult,
  stateNames,
  templatesById,
  WILDCARD,
} from './helpers'

export function validateGameType(gameType: GameType): CheckResult {
  const violations: Violation[] = []
  const archetypes = archetypesById(gameType)
  const actionScopes = new Map(gameType.action_registry.map((a) => [a.name, a.scope]))
  const templateIds = new Set(gameType.rule_templates.map((t) => t.id))

  const checkAction = (name: string, allowed: ActionScope[], path: string): void => {
    const scope = actionScopes.get(name)
    if (scope === undefined) {
      violations.push({
        severity: 'error',
        field_path: path,
        constraint: 'action_registered',
        expected: `one of [${[...actionScopes.keys()].join(', ')}]`,
        actual: name,
        suggestion: 'Register the action in action_registry or reference a registered action name',
      })
    } else if (scope !== 'both' && !allowed.includes(scope)) {
      violations.push({
        severity: 'error',
        field_path: path,
        constraint: 'action_scope_compatible',
        expected: `an action with scope ${allowed.join('|')} or both`,
        actual: `"${name}" has scope ${scope}`,
        suggestion: `Use an action whose scope allows this reference, or widen "${name}" to scope both`,
      })
    }
  }

  // state_effect enum guard (G6): a typo'd value must be rejected at
  // registration — the engine also refuses to execute unknown values.
  const legalStateEffects = ['advance_state', 'complete_state', 'none']
  const templateKinds = new Map(gameType.rule_templates.map((t) => [t.id, t.type]))
  gameType.action_registry.forEach((action, i) => {
    if (action.state_effect !== undefined && !legalStateEffects.includes(action.state_effect)) {
      violations.push({
        severity: 'error',
        field_path: `game_type.action_registry[${i}].state_effect`,
        constraint: 'state_effect_registered',
        expected: `one of [${legalStateEffects.join(', ')}]`,
        actual: String(action.state_effect),
        suggestion:
          'Use a declared state_effect value (advance_state / complete_state / none) or omit the field',
      })
    }
    // trigger bindings: each id must resolve to a registered rule template,
    // and must NOT be a state_transition template — those fire via
    // action_event_mapping events, so a state_transition id in `triggers`
    // would be a silent no-op (same G6 no-silent-typo discipline).
    ;(action.triggers ?? []).forEach((templateId, j) => {
      const path = `game_type.action_registry[${i}].triggers[${j}]`
      const kind = templateKinds.get(templateId)
      if (kind === undefined) {
        violations.push({
          severity: 'error',
          field_path: path,
          constraint: 'trigger_template_registered',
          expected: `one of [${[...templateIds].join(', ')}]`,
          actual: templateId,
          suggestion: 'Reference a registered RuleTemplate id, or remove it from triggers',
        })
      } else if (kind === 'state_transition') {
        violations.push({
          severity: 'error',
          field_path: path,
          constraint: 'trigger_template_kind',
          expected:
            'a condition_action / temporal_sequence / interaction_matrix template (state_transition is event-driven via action_event_mapping)',
          actual: `"${templateId}" is a state_transition template`,
          suggestion:
            'Drive state_transition rules through action_event_mapping events, not triggers; remove this id from triggers',
        })
      }
    })
  })

  gameType.rule_templates.forEach((template, i) => {
    const base = `game_type.rule_templates[${i}]`
    if (template.type === 'temporal_sequence') {
      checkAction(
        template.sequence_schema.step_schema.action,
        ['rule_verb'],
        `${base}.sequence_schema.step_schema.action`
      )
    } else if (template.type === 'condition_action') {
      template.action_schema.verbs.forEach((verb, j) => {
        checkAction(verb, ['rule_verb'], `${base}.action_schema.verbs[${j}]`)
      })
    } else if (template.type === 'interaction_matrix') {
      template.matrix_schema.effect_schema.forEach((effect, j) => {
        checkAction(
          effect.effect,
          ['rule_verb'],
          `${base}.matrix_schema.effect_schema[${j}].effect`
        )
      })
      // pair_match_attributes must exist on every participating archetype
      // (one carrying at least one entity_type_attribute) — H2.
      const entityAttrs = template.matrix_schema.entity_type_attributes ?? []
      const participating = [...archetypes.values()].filter((archetype) =>
        archetype.attributes.some((attr) => entityAttrs.includes(attr.name))
      )
      ;(template.matrix_schema.pair_match_attributes ?? []).forEach((name, j) => {
        const missingOn = participating.filter(
          (archetype) => !archetype.attributes.some((attr) => attr.name === name)
        )
        if (missingOn.length > 0) {
          violations.push({
            severity: 'error',
            field_path: `${base}.matrix_schema.pair_match_attributes[${j}]`,
            constraint: 'attribute_defined',
            expected: 'an attribute present on every participating archetype',
            actual: `"${name}" missing on [${missingOn.map((a) => a.id).join(', ')}]`,
            suggestion: `Declare attribute "${name}" on the participating archetypes or remove it from pair_match_attributes`,
          })
        }
      })
    }
  })

  // timed_emitters: registration-time referential integrity (game-agnostic
  // timed decay). Mirrors the trigger/state_effect guards. ABSENT → no checks,
  // so games without the field are wholly unaffected.
  const templatesMap = templatesById(gameType)
  const emitterIds = new Map<string, number>()
  ;(gameType.timed_emitters ?? []).forEach((emitter, i) => {
    const base = `game_type.timed_emitters[${i}]`
    const firstIndex = emitterIds.get(emitter.id)
    if (firstIndex !== undefined) {
      violations.push({
        severity: 'error',
        field_path: `${base}.id`,
        constraint: 'emitter_id_unique',
        expected: 'a GameType-unique timed_emitter id',
        actual: `"${emitter.id}" already declared at game_type.timed_emitters[${firstIndex}]`,
        suggestion:
          'Rename one of the emitters — ids key initial_timers overrides and the runtime charge map, so collisions silently merge charge',
      })
    } else {
      emitterIds.set(emitter.id, i)
    }

    const kind = templateKinds.get(emitter.target_template)
    const target = templatesMap.get(emitter.target_template)
    if (kind === undefined) {
      violations.push({
        severity: 'error',
        field_path: `${base}.target_template`,
        constraint: 'emitter_template_registered',
        expected: `one of [${[...templateIds].join(', ')}]`,
        actual: emitter.target_template,
        suggestion: 'Reference a registered state_transition RuleTemplate id',
      })
    } else if (kind !== 'state_transition') {
      violations.push({
        severity: 'error',
        field_path: `${base}.target_template`,
        constraint: 'emitter_template_kind',
        expected:
          'a state_transition template (advanceTime fires the event through executeStateTransition)',
        actual: `"${emitter.target_template}" is a ${kind} template`,
        suggestion:
          'Point the emitter at a state_transition template; only those consume timed events',
      })
    } else if (target?.type === 'state_transition') {
      const events = target.transition_table_schema.events
      if (!events.includes(emitter.event)) {
        violations.push({
          severity: 'error',
          field_path: `${base}.event`,
          constraint: 'emitter_event_in_table',
          expected: `one of [${events.join(', ')}]`,
          actual: emitter.event,
          suggestion: `Use an event declared in "${emitter.target_template}".transition_table_schema.events, or add it there`,
        })
      }
    }

    if (emitter.target?.kind === 'archetype' && !archetypes.has(emitter.target.archetype)) {
      violations.push({
        severity: 'error',
        field_path: `${base}.target.archetype`,
        constraint: 'emitter_target_archetype',
        expected: `one of [${[...archetypes.keys()].join(', ')}]`,
        actual: emitter.target.archetype,
        suggestion: 'Reference a registered ElementArchetype id',
      })
    }

    const intervalValid =
      typeof emitter.interval_ms === 'number' &&
      Number.isFinite(emitter.interval_ms) &&
      emitter.interval_ms > 0
    if (!intervalValid) {
      violations.push({
        severity: 'error',
        field_path: `${base}.interval_ms`,
        constraint: 'emitter_interval_positive',
        expected: 'a finite number > 0',
        actual: String(emitter.interval_ms),
        suggestion: 'Set interval_ms to a positive number of milliseconds between ticks',
      })
    }

    if (emitter.warning_lead_ms !== undefined) {
      const lead = emitter.warning_lead_ms
      const leadValid =
        typeof lead === 'number' &&
        Number.isFinite(lead) &&
        lead >= 0 &&
        (!intervalValid || lead < emitter.interval_ms)
      if (!leadValid) {
        violations.push({
          severity: 'error',
          field_path: `${base}.warning_lead_ms`,
          constraint: 'emitter_warning_lead_bounds',
          expected: `0 <= warning_lead_ms < interval_ms (${emitter.interval_ms})`,
          actual: String(lead),
          suggestion: 'Set warning_lead_ms within [0, interval_ms)',
        })
      }
    }
  })

  // state_values_unique (F2/TC-06): a duplicate value in a state enum silently
  // corrupts every indexOf-based rank comparison (stateValueOrder,
  // applyStateEffect, evaluateOptimizationTarget) — advance_state and the
  // optimization_target ranking both read the FIRST index of a value. Mirrors
  // the emitter_id_unique dedup idea.
  gameType.element_archetypes.forEach((archetype, ai) => {
    ;(archetype.states ?? []).forEach((state, si) => {
      if (!state.values) return
      const seen = new Map<string, number>()
      state.values.forEach((value, vi) => {
        const first = seen.get(value)
        if (first !== undefined) {
          violations.push({
            severity: 'error',
            field_path: `game_type.element_archetypes[${ai}].states[${si}].values[${vi}]`,
            constraint: 'state_values_unique',
            expected: `each value of state "${state.name}" declared at most once`,
            actual: `"${value}" already declared at index ${first}`,
            suggestion: `Remove the duplicate "${value}" — duplicate state values corrupt every indexOf-based rank comparison (advance_state, optimization_target)`,
          })
        } else {
          seen.set(value, vi)
        }
      })
    })
  })

  const template = gameType.information_partition_template
  if (!template) {
    // Forms whose floor checks NEED the partition may not omit it: without
    // role visibility / rule visibility / channels / action capabilities the
    // hidden-info floors have no basis, and degenerate levels (e.g.
    // initially-solved) could publish without a real information partition.
    if (PARTITION_REQUIRED_CO_PLAY_FORMS.includes(gameType.co_play_form)) {
      violations.push({
        severity: 'error',
        field_path: 'game_type.information_partition_template',
        constraint: 'partition_template_required',
        expected: `an information_partition_template (co_play_form "${gameType.co_play_form}" floor checks need role/rule visibility, channels, and action capabilities)`,
        actual: 'missing',
        suggestion:
          'Declare information_partition_template on the GameType, or use a shared-state co-play form that may omit it',
      })
    }
    return buildCheckResult('gametype_consistency', violations)
  }

  const roleIds = new Set(template.roles.map((role) => role.id))
  const requireRole = (role: string, path: string): void => {
    if (!roleIds.has(role)) {
      violations.push({
        severity: 'error',
        field_path: path,
        constraint: 'role_defined',
        expected: `one of [${[...roleIds].join(', ')}]`,
        actual: role,
        suggestion: 'Reference a role declared in information_partition_template.roles',
      })
    }
  }
  const requireArchetypeNames = (
    archetype: ElementArchetype,
    listed: string[],
    all: string[],
    path: string,
    kind: 'attribute' | 'state'
  ): void => {
    listed.forEach((name, k) => {
      if (name !== WILDCARD && !all.includes(name)) {
        violations.push({
          severity: 'error',
          field_path: `${path}[${k}]`,
          constraint: `${kind}_defined`,
          expected: `"${WILDCARD}" or one of [${all.join(', ')}]`,
          actual: name,
          suggestion: `Use ${kind} names defined on archetype "${archetype.id}" (or "${WILDCARD}")`,
        })
      }
    })
  }

  const base = 'game_type.information_partition_template'
  template.visibility_rules.forEach((rule, i) => {
    requireRole(rule.role, `${base}.visibility_rules[${i}].role`)
    const sides = [
      { entries: rule.can_see, key: 'can_see' },
      { entries: rule.cannot_see, key: 'cannot_see' },
    ]
    for (const side of sides) {
      side.entries.forEach((entry, j) => {
        const entryPath = `${base}.visibility_rules[${i}].${side.key}[${j}]`
        if (entry.element_archetype === WILDCARD) return
        const archetype = archetypes.get(entry.element_archetype)
        if (!archetype) {
          violations.push({
            severity: 'error',
            field_path: `${entryPath}.element_archetype`,
            constraint: 'archetype_registered',
            expected: `"${WILDCARD}" or one of [${[...archetypes.keys()].join(', ')}]`,
            actual: entry.element_archetype,
            suggestion: 'Reference a registered ElementArchetype id (or "*" for all)',
          })
          return
        }
        requireArchetypeNames(
          archetype,
          entry.attributes,
          attributeNames(archetype),
          `${entryPath}.attributes`,
          'attribute'
        )
        requireArchetypeNames(
          archetype,
          entry.states,
          stateNames(archetype),
          `${entryPath}.states`,
          'state'
        )
      })
    }
  })

  template.rule_visibility.forEach((entry, i) => {
    requireRole(entry.role, `${base}.rule_visibility[${i}].role`)
    entry.visible_rule_templates.forEach((id, j) => {
      if (id !== WILDCARD && !templateIds.has(id)) {
        violations.push({
          severity: 'error',
          field_path: `${base}.rule_visibility[${i}].visible_rule_templates[${j}]`,
          constraint: 'template_registered',
          expected: `"${WILDCARD}" or one of [${[...templateIds].join(', ')}]`,
          actual: id,
          suggestion: 'Reference a registered RuleTemplate id (or "*" for all)',
        })
      }
    })
  })

  template.action_capability.forEach((capability, i) => {
    requireRole(capability.role, `${base}.action_capability[${i}].role`)
    capability.can_perform.forEach((name, j) => {
      checkAction(name, ['player_action'], `${base}.action_capability[${i}].can_perform[${j}]`)
    })
    capability.target_archetypes.forEach((id, j) => {
      if (!archetypes.has(id)) {
        violations.push({
          severity: 'error',
          field_path: `${base}.action_capability[${i}].target_archetypes[${j}]`,
          constraint: 'archetype_registered',
          expected: `one of [${[...archetypes.keys()].join(', ')}]`,
          actual: id,
          suggestion: 'Reference a registered ElementArchetype id',
        })
      }
    })
  })

  template.communication_channels.forEach((channel, i) => {
    requireRole(channel.from, `${base}.communication_channels[${i}].from`)
    requireRole(channel.to, `${base}.communication_channels[${i}].to`)
  })

  // shared_label_attributes: archetype + attributes exist, and every
  // communicating role can_see each attribute (cross-role co-reference).
  const communicatingRoles = new Set<string>()
  for (const channel of template.communication_channels) {
    communicatingRoles.add(channel.from)
    communicatingRoles.add(channel.to)
  }
  const roleCanSee = (role: string, archetypeId: string, attribute: string): boolean => {
    const rule = template.visibility_rules.find((entry) => entry.role === role)
    return (rule?.can_see ?? []).some(
      (entry) =>
        (entry.element_archetype === WILDCARD || entry.element_archetype === archetypeId) &&
        (entry.attributes.includes(WILDCARD) || entry.attributes.includes(attribute))
    )
  }
  template.shared_label_attributes.forEach((entry, i) => {
    const entryPath = `${base}.shared_label_attributes[${i}]`
    const archetype = archetypes.get(entry.element_archetype)
    if (!archetype) {
      violations.push({
        severity: 'error',
        field_path: `${entryPath}.element_archetype`,
        constraint: 'archetype_registered',
        expected: `one of [${[...archetypes.keys()].join(', ')}]`,
        actual: entry.element_archetype,
        suggestion: 'Reference a registered ElementArchetype id',
      })
      return
    }
    entry.attributes.forEach((attribute, j) => {
      const attrPath = `${entryPath}.attributes[${j}]`
      if (!attributeNames(archetype).includes(attribute)) {
        violations.push({
          severity: 'error',
          field_path: attrPath,
          constraint: 'attribute_defined',
          expected: `one of [${attributeNames(archetype).join(', ')}]`,
          actual: attribute,
          suggestion: `Use an attribute defined on archetype "${archetype.id}"`,
        })
        return
      }
      for (const role of communicatingRoles) {
        if (!roleCanSee(role, entry.element_archetype, attribute)) {
          violations.push({
            severity: 'error',
            field_path: attrPath,
            constraint: 'shared_label_visible_to_all',
            expected: `"${attribute}" in every communicating role's can_see for "${entry.element_archetype}"`,
            actual: `role "${role}" cannot see it`,
            suggestion: `Add "${attribute}" of "${entry.element_archetype}" to role "${role}"'s can_see, or drop it from shared_label_attributes`,
          })
        }
      }
    })
  })

  return buildCheckResult('gametype_consistency', violations)
}
