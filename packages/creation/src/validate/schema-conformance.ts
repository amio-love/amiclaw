/**
 * schema_conformance — everything the loader's structural narrowing lets
 * through: id cross-references (archetypes, templates, elements), enum/range
 * membership, required attributes, binding params, partition view references
 * with "*" wildcard expansion, win-condition type match, the exact
 * game_type_version binding, co_play_form catalog registration, and the
 * AI-authored nesting ceiling (Level → elements[] → params{} is the deepest
 * legal level; spec Invariants). Rule bindings follow the canonical per-kind
 * shapes of the spec Mechanism binding contract: template-instantiated
 * structures — condition_action predicates[]/combinator/action tuples,
 * state_transition transitions[] rows, interaction_matrix matrix[] rows —
 * are CONTROLLED nesting validated against the owning template's schemas,
 * exempt from the free-value flatness rule; temporal_sequence binds flat
 * step params.
 *
 * Assumes the GameType itself already passed the registration-time
 * gametype_consistency gate (see gametype-consistency.ts).
 */

import type {
  AttributeDefinition,
  CheckResult,
  ConditionActionRuleTemplate,
  CoPlayFormCatalog,
  GameType,
  InteractionMatrixRuleTemplate,
  Level,
  LevelRule,
  ParamDef,
  RuleTemplate,
  StateDefinition,
  StateTransitionRuleTemplate,
  Violation,
} from '../schema/types'
import {
  archetypesById,
  attributeNames,
  buildCheckResult,
  elementsById,
  formatValue,
  isFlatValue,
  isMappingValue,
  stateNames,
  templatesById,
  WILDCARD,
} from './helpers'

export function checkSchemaConformance(
  gameType: GameType,
  level: Level,
  catalog: CoPlayFormCatalog
): CheckResult {
  const violations: Violation[] = []
  const archetypes = archetypesById(gameType)
  const templates = templatesById(gameType)
  const elements = elementsById(level)

  if (level.metadata.game_type !== gameType.id) {
    violations.push({
      severity: 'error',
      field_path: 'metadata.game_type',
      constraint: 'game_type_reference',
      expected: gameType.id,
      actual: level.metadata.game_type,
      suggestion: `Validate this level against its own GameType, or set metadata.game_type to "${gameType.id}"`,
    })
  }

  if (level.metadata.game_type_version !== gameType.version) {
    violations.push({
      severity: 'error',
      field_path: 'metadata.game_type_version',
      constraint: 'version_binding',
      expected: gameType.version,
      actual: level.metadata.game_type_version,
      suggestion: `Set metadata.game_type_version to the exact GameType version "${gameType.version}" (spec invariant: exact match)`,
    })
  }

  if (!catalog.some((form) => form.id === gameType.co_play_form)) {
    violations.push({
      severity: 'error',
      field_path: 'game_type.co_play_form',
      constraint: 'co_play_form_registered',
      expected: `one of [${catalog.map((form) => form.id).join(', ')}]`,
      actual: gameType.co_play_form,
      suggestion:
        'Register the new co-play form (with its floor checks) in the CoPlayFormCatalog, or declare a registered form',
    })
  }

  level.elements.forEach((element, i) => {
    const archetype = archetypes.get(element.archetype)
    if (!archetype) {
      violations.push({
        severity: 'error',
        field_path: `elements[${i}].archetype`,
        constraint: 'archetype_registered',
        expected: `one of [${[...archetypes.keys()].join(', ')}]`,
        actual: element.archetype,
        suggestion: 'Reference a registered ElementArchetype id from the GameType vocabulary',
      })
      return
    }
    const attributesByName = new Map(archetype.attributes.map((a) => [a.name, a]))
    for (const [key, value] of Object.entries(element.params)) {
      const path = `elements[${i}].params.${key}`
      const attribute = attributesByName.get(key)
      if (!attribute) {
        violations.push({
          severity: 'error',
          field_path: path,
          constraint: 'attribute_defined',
          expected: `one of [${attributeNames(archetype).join(', ')}]`,
          actual: key,
          suggestion: `Remove "${key}" or use an attribute defined on archetype "${archetype.id}"`,
        })
        continue
      }
      if (!isFlatValue(value)) {
        violations.push({
          severity: 'error',
          field_path: path,
          constraint: 'max_nesting_depth',
          expected:
            'a scalar (or array of scalars for type=set) — params{} is the deepest AI-authored level',
          actual: formatValue(value),
          suggestion:
            'Flatten the value: AI-authored Level content must not nest beyond Level → elements[] → params{}',
        })
        continue
      }
      const valueViolation = checkAttributeValue(attribute, value, path)
      if (valueViolation) violations.push(valueViolation)
    }
    for (const attribute of archetype.attributes) {
      if (attribute.required && element.params[attribute.name] === undefined) {
        violations.push({
          severity: 'error',
          field_path: `elements[${i}].params.${attribute.name}`,
          constraint: 'required_attribute_present',
          expected: `a value for required attribute "${attribute.name}"`,
          actual: 'missing',
          suggestion: `Set params.${attribute.name} on element "${element.id}" (archetype "${archetype.id}" requires it)`,
        })
      }
    }
    // Per-instance initial_states overrides: each key must name a declared
    // state of the archetype, and (for enum/range states) its value must be
    // within the declared value domain — mirroring the params enum path.
    const statesByName = new Map((archetype.states ?? []).map((s) => [s.name, s]))
    for (const [key, value] of Object.entries(element.initial_states ?? {})) {
      const path = `elements[${i}].initial_states.${key}`
      const state = statesByName.get(key)
      if (!state) {
        violations.push({
          severity: 'error',
          field_path: path,
          constraint: 'state_defined',
          expected: `one of [${stateNames(archetype).join(', ')}]`,
          actual: key,
          suggestion: `Remove "${key}" or use a state declared on archetype "${archetype.id}"`,
        })
        continue
      }
      // Parity with the params path: initial_states are AI-authorable, so a
      // nested value is a nesting-ceiling violation before the domain check.
      if (!isFlatValue(value)) {
        violations.push({
          severity: 'error',
          field_path: path,
          constraint: 'max_nesting_depth',
          expected: 'a scalar — initial_states values are the deepest AI-authored level',
          actual: formatValue(value),
          suggestion:
            'Flatten the value: AI-authored Level content must not nest beyond elements[].initial_states',
        })
        continue
      }
      const stateViolation = checkStateValue(state, value, path)
      if (stateViolation) violations.push(stateViolation)
    }
  })

  level.rules.forEach((rule, i) => {
    const template = templates.get(rule.template)
    if (!template) {
      violations.push({
        severity: 'error',
        field_path: `rules[${i}].template`,
        constraint: 'template_registered',
        expected: `one of [${[...templates.keys()].join(', ')}]`,
        actual: rule.template,
        suggestion: 'Reference a registered RuleTemplate id from the GameType vocabulary',
      })
    } else {
      validateRuleBindings(template, rule, i, gameType, violations)
    }
    rule.target_elements.forEach((targetId, j) => {
      if (!elements.has(targetId)) {
        violations.push({
          severity: 'error',
          field_path: `rules[${i}].target_elements[${j}]`,
          constraint: 'element_reference',
          expected: `one of [${[...elements.keys()].join(', ')}]`,
          actual: targetId,
          suggestion: `Reference an element instance declared in this level`,
        })
      }
    })
  })

  const roles = new Set(
    (gameType.information_partition_template?.roles ?? []).map((role) => role.id)
  )
  level.information_partition.role_assignments.forEach((assignment, i) => {
    const basePath = `information_partition.role_assignments[${i}]`
    if (gameType.information_partition_template && !roles.has(assignment.role)) {
      violations.push({
        severity: 'error',
        field_path: `${basePath}.role`,
        constraint: 'role_defined',
        expected: `one of [${[...roles].join(', ')}]`,
        actual: assignment.role,
        suggestion:
          'Assign views only to roles declared in the GameType information partition template',
      })
    }
    assignment.element_views.forEach((view, j) => {
      const viewPath = `${basePath}.element_views[${j}]`
      const element = elements.get(view.element_id)
      if (!element) {
        violations.push({
          severity: 'error',
          field_path: `${viewPath}.element_id`,
          constraint: 'element_reference',
          expected: `one of [${[...elements.keys()].join(', ')}]`,
          actual: view.element_id,
          suggestion: 'Reference an element instance declared in this level',
        })
        return
      }
      const archetype = archetypes.get(element.archetype)
      if (!archetype) return // already reported on the element itself
      checkViewNames(
        view.visible_attributes,
        attributeNames(archetype),
        `${viewPath}.visible_attributes`,
        archetype.id,
        'attribute',
        violations
      )
      checkViewNames(
        view.visible_states,
        stateNames(archetype),
        `${viewPath}.visible_states`,
        archetype.id,
        'state',
        violations
      )
    })
  })

  if (level.win_condition.type !== gameType.win_condition_type.type) {
    violations.push({
      severity: 'error',
      field_path: 'win_condition.type',
      constraint: 'win_condition_type_match',
      expected: gameType.win_condition_type.type,
      actual: level.win_condition.type,
      suggestion: `Use the GameType's declared win condition type "${gameType.win_condition_type.type}"`,
    })
  }

  return buildCheckResult('schema_conformance', violations)
}

function checkAttributeValue(
  attribute: AttributeDefinition,
  value: unknown,
  path: string
): Violation | undefined {
  switch (attribute.type) {
    case 'enum': {
      const values = attribute.values ?? []
      if (typeof value !== 'string' || !values.includes(value)) {
        return {
          severity: 'error',
          field_path: path,
          constraint: 'enum_membership',
          expected: `one of [${values.join(', ')}]`,
          actual: formatValue(value),
          suggestion: `Set the value to one of the legal enum values: ${values.join(', ')}`,
        }
      }
      return undefined
    }
    case 'range': {
      if (typeof value !== 'number') {
        return rangeViolation(attribute, value, path)
      }
      const { min, max, step } = attribute
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        return rangeViolation(attribute, value, path)
      }
      if (min !== undefined && step !== undefined) {
        const steps = (value - min) / step
        if (Math.abs(Math.round(steps) - steps) > 1e-9) {
          return rangeViolation(attribute, value, path)
        }
      }
      return undefined
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return {
          severity: 'error',
          field_path: path,
          constraint: 'type_match',
          expected: 'a boolean',
          actual: formatValue(value),
          suggestion: 'Set the value to true or false',
        }
      }
      return undefined
    }
    case 'set': {
      const values = attribute.values ?? []
      const members = Array.isArray(value) ? value : undefined
      if (!members || members.some((m) => typeof m !== 'string' || !values.includes(m))) {
        return {
          severity: 'error',
          field_path: path,
          constraint: 'set_membership',
          expected: `an array drawn from [${values.join(', ')}]`,
          actual: formatValue(value),
          suggestion: `Use an array whose members are legal values: ${values.join(', ')}`,
        }
      }
      return undefined
    }
  }
}

function rangeViolation(attribute: AttributeDefinition, value: unknown, path: string): Violation {
  const bounds = `${attribute.min ?? '-inf'}..${attribute.max ?? 'inf'}${
    attribute.step !== undefined ? ` step ${attribute.step}` : ''
  }`
  return {
    severity: 'error',
    field_path: path,
    constraint: 'range_membership',
    expected: `a number in ${bounds}`,
    actual: formatValue(value),
    suggestion: `Set the value to a number within ${bounds}`,
  }
}

/** Validate a per-instance initial_states value against its declared state domain. */
function checkStateValue(
  state: StateDefinition,
  value: unknown,
  path: string
): Violation | undefined {
  if (state.type === 'enum') {
    const values = state.values ?? []
    if (typeof value !== 'string' || !values.includes(value)) {
      return {
        severity: 'error',
        field_path: path,
        constraint: 'enum_membership',
        expected: `one of [${values.join(', ')}]`,
        actual: formatValue(value),
        suggestion: `Set the value to one of the legal state values: ${values.join(', ')}`,
      }
    }
    return undefined
  }
  // range state
  const { min, max, step } = state
  const bounds = `${min ?? '-inf'}..${max ?? 'inf'}${step !== undefined ? ` step ${step}` : ''}`
  if (
    typeof value !== 'number' ||
    (min !== undefined && value < min) ||
    (max !== undefined && value > max) ||
    (min !== undefined &&
      step !== undefined &&
      Math.abs(Math.round((value - min) / step) - (value - min) / step) > 1e-9)
  ) {
    return {
      severity: 'error',
      field_path: path,
      constraint: 'range_membership',
      expected: `a number in ${bounds}`,
      actual: formatValue(value),
      suggestion: `Set the value to a number within ${bounds}`,
    }
  }
  return undefined
}

/**
 * Known param_def type vocabulary observed in the spec ("string", "int").
 * Unknown type ids are skipped — the spec leaves the vocabulary open
 * (SPEC-DEFECT #1 in the R1 report).
 */
function checkParamValueType(
  paramType: string,
  value: unknown,
  path: string
): Violation | undefined {
  const violate = (expected: string): Violation => ({
    severity: 'error',
    field_path: path,
    constraint: 'type_match',
    expected,
    actual: formatValue(value),
    suggestion: `Set the binding to ${expected}`,
  })
  if (paramType === 'string' && typeof value !== 'string') return violate('a string')
  if (paramType === 'int' && !Number.isInteger(value)) return violate('an integer')
  if ((paramType === 'float' || paramType === 'number') && typeof value !== 'number') {
    return violate('a number')
  }
  if ((paramType === 'boolean' || paramType === 'bool') && typeof value !== 'boolean') {
    return violate('a boolean')
  }
  return undefined
}

function checkViewNames(
  listed: string[],
  all: string[],
  path: string,
  archetypeId: string,
  kind: 'attribute' | 'state',
  violations: Violation[]
): void {
  listed.forEach((name, k) => {
    if (name !== WILDCARD && !all.includes(name)) {
      violations.push({
        severity: 'error',
        field_path: `${path}[${k}]`,
        constraint: `${kind}_defined`,
        expected: `"${WILDCARD}" or one of [${all.join(', ')}]`,
        actual: name,
        suggestion: `Use ${kind} names defined on archetype "${archetypeId}" (or "${WILDCARD}" for all)`,
      })
    }
  })
}

/**
 * Binding instantiation contract (spec Mechanism, RuleTemplate binding
 * contract): each template kind admits exactly ONE canonical binding shape.
 * Template-instantiated structures — predicates[] lists, action tuples,
 * transitions[] rows, matrix[] rows — are CONTROLLED nesting validated
 * against the owning template's schemas; only temporal_sequence binds flat
 * free params, which keep the flatness ceiling.
 */
function validateRuleBindings(
  template: RuleTemplate,
  rule: LevelRule,
  ruleIndex: number,
  gameType: GameType,
  violations: Violation[]
): void {
  const basePath = `rules[${ruleIndex}].bindings`
  switch (template.type) {
    case 'condition_action': {
      for (const [key, value] of Object.entries(rule.bindings)) {
        const path = `${basePath}.${key}`
        if (key === 'predicates') {
          validatePredicatesBinding(template, value, path, violations)
        } else if (key === 'combinator') {
          validateCombinatorBinding(template, value, path, violations)
        } else if (key === 'action') {
          validateActionBinding(template, gameType, value, path, violations)
        } else {
          violations.push(
            unknownBindingKey(path, key, ['predicates', 'combinator', 'action'], template.id)
          )
        }
      }
      return
    }
    case 'state_transition': {
      for (const [key, value] of Object.entries(rule.bindings)) {
        const path = `${basePath}.${key}`
        if (key === 'transitions') validateTransitionsBinding(template, value, path, violations)
        else violations.push(unknownBindingKey(path, key, ['transitions'], template.id))
      }
      return
    }
    case 'interaction_matrix': {
      for (const [key, value] of Object.entries(rule.bindings)) {
        const path = `${basePath}.${key}`
        if (key === 'matrix') validateMatrixBinding(template, value, path, violations)
        else violations.push(unknownBindingKey(path, key, ['matrix'], template.id))
      }
      return
    }
    case 'temporal_sequence': {
      const params = new Map(template.sequence_schema.step_schema.params.map((p) => [p.name, p]))
      for (const [key, value] of Object.entries(rule.bindings)) {
        const path = `${basePath}.${key}`
        const param = params.get(key)
        if (!param) {
          violations.push(unknownBindingKey(path, key, [...params.keys()], template.id))
          continue
        }
        if (!isFlatValue(value)) {
          violations.push({
            severity: 'error',
            field_path: path,
            constraint: 'max_nesting_depth',
            expected: 'a scalar binding value — bindings are the deepest AI-authored level',
            actual: formatValue(value),
            suggestion:
              'Flatten the binding value: AI-authored Level content must not nest beyond rules[].bindings',
          })
          continue
        }
        const typeViolation = checkParamValueType(param.type, value, path)
        if (typeViolation) violations.push(typeViolation)
      }
      return
    }
  }
}

function unknownBindingKey(
  path: string,
  key: string,
  legalKeys: string[],
  templateId: string
): Violation {
  return {
    severity: 'error',
    field_path: path,
    constraint: 'binding_param_defined',
    expected: `one of [${legalKeys.join(', ')}]`,
    actual: key,
    suggestion: `Use the canonical binding shape for template "${templateId}" (spec Mechanism binding contract)`,
  }
}

/**
 * Controlled predicates[] binding: each entry instantiates a predicate
 * declared by the template's condition_schema, with the predicate's params
 * INLINED in the entry (canonical shape: {name: species_is, species: fern}).
 */
function validatePredicatesBinding(
  template: ConditionActionRuleTemplate,
  value: unknown,
  path: string,
  violations: Violation[]
): void {
  if (!Array.isArray(value)) {
    violations.push(
      controlledStructureViolation(
        path,
        'a predicates[] list instantiating condition_schema',
        value
      )
    )
    return
  }
  const declared = new Map(template.condition_schema.predicates.map((p) => [p.name, p]))
  value.forEach((entry, j) => {
    const entryPath = `${path}[${j}]`
    if (!isMappingValue(entry)) {
      violations.push(
        controlledStructureViolation(
          entryPath,
          'a {name, <param>: <value>} predicate instantiation',
          entry
        )
      )
      return
    }
    const { name, ...inlined } = entry
    const predicate = typeof name === 'string' ? declared.get(name) : undefined
    if (!predicate) {
      violations.push({
        severity: 'error',
        field_path: `${entryPath}.name`,
        constraint: 'predicate_registered',
        expected: `one of [${[...declared.keys()].join(', ')}]`,
        actual: formatValue(name),
        suggestion: 'Instantiate a predicate declared by the template condition_schema',
      })
      return
    }
    validateInlinedParams(predicate.params, inlined, entryPath, violations)
  })
}

/**
 * Optional single combinator over the predicates[] list. Legal values come
 * from the template's condition_schema.combinators; omitting it defaults to
 * AND (spec Mechanism binding contract).
 */
function validateCombinatorBinding(
  template: ConditionActionRuleTemplate,
  value: unknown,
  path: string,
  violations: Violation[]
): void {
  const legal = template.condition_schema.combinators
  if (typeof value !== 'string' || !(legal as string[]).includes(value)) {
    violations.push({
      severity: 'error',
      field_path: path,
      constraint: 'combinator_registered',
      expected: `one of [${legal.join(', ')}] (optional; defaults to AND when omitted)`,
      actual: formatValue(value),
      suggestion: `Use a combinator declared by template "${template.id}" condition_schema.combinators, or omit it to default to AND`,
    })
  }
}

/**
 * Controlled action tuple binding: {verb, <param>: <value>} — the verb comes
 * from the template's action_schema.verbs, the inlined params validate
 * against the registered action's param_defs.
 */
function validateActionBinding(
  template: ConditionActionRuleTemplate,
  gameType: GameType,
  value: unknown,
  path: string,
  violations: Violation[]
): void {
  if (!isMappingValue(value)) {
    violations.push(
      controlledStructureViolation(
        path,
        'an action tuple {verb, <param>: <value>} instantiating action_schema',
        value
      )
    )
    return
  }
  const { verb, ...inlined } = value
  if (typeof verb !== 'string' || !template.action_schema.verbs.includes(verb)) {
    violations.push({
      severity: 'error',
      field_path: `${path}.verb`,
      constraint: 'verb_registered',
      expected: `one of [${template.action_schema.verbs.join(', ')}]`,
      actual: formatValue(verb),
      suggestion: 'Instantiate a verb declared by the template action_schema',
    })
    return
  }
  const registryEntry = gameType.action_registry.find((action) => action.name === verb)
  validateInlinedParams(registryEntry?.params ?? [], inlined, path, violations)
}

/** Controlled transitions[] binding: [state, event, next_state] rows. */
function validateTransitionsBinding(
  template: StateTransitionRuleTemplate,
  value: unknown,
  path: string,
  violations: Violation[]
): void {
  if (!Array.isArray(value)) {
    violations.push(
      controlledStructureViolation(
        path,
        'a transitions[] list of [state, event, next_state] rows',
        value
      )
    )
    return
  }
  const { states, events } = template.transition_table_schema
  value.forEach((row, j) => {
    const rowPath = `${path}[${j}]`
    if (!Array.isArray(row) || row.length !== 3) {
      violations.push(
        controlledStructureViolation(rowPath, 'a [state, event, next_state] triple', row)
      )
      return
    }
    const [from, event, to] = row as unknown[]
    if (typeof from !== 'string' || !states.includes(from)) {
      violations.push(rowValueViolation(`${rowPath}[0]`, 'state_declared', states, from))
    }
    if (typeof event !== 'string' || !events.includes(event)) {
      violations.push(rowValueViolation(`${rowPath}[1]`, 'event_declared', events, event))
    }
    if (typeof to !== 'string' || !states.includes(to)) {
      violations.push(rowValueViolation(`${rowPath}[2]`, 'state_declared', states, to))
    }
  })
}

/** Controlled matrix[] binding: [entity_a, entity_b, relation] rows. */
function validateMatrixBinding(
  template: InteractionMatrixRuleTemplate,
  value: unknown,
  path: string,
  violations: Violation[]
): void {
  if (!Array.isArray(value)) {
    violations.push(
      controlledStructureViolation(
        path,
        'a matrix[] list of [entity_a, entity_b, relation] rows',
        value
      )
    )
    return
  }
  const { entity_types, relation_types } = template.matrix_schema
  value.forEach((row, j) => {
    const rowPath = `${path}[${j}]`
    if (!Array.isArray(row) || row.length !== 3) {
      violations.push(
        controlledStructureViolation(rowPath, 'an [entity_a, entity_b, relation] triple', row)
      )
      return
    }
    const [a, b, relation] = row as unknown[]
    if (typeof a !== 'string' || !entity_types.includes(a)) {
      violations.push(rowValueViolation(`${rowPath}[0]`, 'entity_type_declared', entity_types, a))
    }
    if (typeof b !== 'string' || !entity_types.includes(b)) {
      violations.push(rowValueViolation(`${rowPath}[1]`, 'entity_type_declared', entity_types, b))
    }
    if (typeof relation !== 'string' || !(relation_types as string[]).includes(relation)) {
      violations.push(
        rowValueViolation(`${rowPath}[2]`, 'relation_type_declared', relation_types, relation)
      )
    }
  })
}

function rowValueViolation(
  path: string,
  constraint: string,
  legal: readonly string[],
  actual: unknown
): Violation {
  return {
    severity: 'error',
    field_path: path,
    constraint,
    expected: `one of [${legal.join(', ')}]`,
    actual: formatValue(actual),
    suggestion: 'Use a value declared by the owning template schema',
  }
}

/** Inlined controlled params: unknown keys rejected, leaf values stay flat. */
function validateInlinedParams(
  paramDefs: ParamDef[],
  inlined: Record<string, unknown>,
  basePath: string,
  violations: Violation[]
): void {
  const defs = new Map(paramDefs.map((p) => [p.name, p]))
  for (const [paramName, paramValue] of Object.entries(inlined)) {
    const paramPath = `${basePath}.${paramName}`
    const def = defs.get(paramName)
    if (!def) {
      violations.push({
        severity: 'error',
        field_path: paramPath,
        constraint: 'binding_param_defined',
        expected: `one of [${[...defs.keys()].join(', ')}]`,
        actual: paramName,
        suggestion: `Remove "${paramName}" or use a declared param name`,
      })
      continue
    }
    if (!isFlatValue(paramValue)) {
      violations.push({
        severity: 'error',
        field_path: paramPath,
        constraint: 'max_nesting_depth',
        expected: 'a flat leaf value — controlled structures bottom out in inlined scalar params',
        actual: formatValue(paramValue),
        suggestion:
          'Flatten the param value: controlled nesting ends at the template-declared params',
      })
      continue
    }
    const typeViolation = checkParamValueType(def.type, paramValue, paramPath)
    if (typeViolation) violations.push(typeViolation)
  }
}

function controlledStructureViolation(path: string, expected: string, value: unknown): Violation {
  return {
    severity: 'error',
    field_path: path,
    constraint: 'controlled_structure',
    expected,
    actual: formatValue(value),
    suggestion: 'Follow the template-declared structure for this controlled binding',
  }
}
