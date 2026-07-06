/**
 * Creation-schema meta-model type definitions.
 *
 * Mirrors the YAML schema in the design spec
 * (docs/architecture/arch-component-creation-schema.md, "Mechanism" section)
 * field-for-field. All identifiers are the spec's snake_case ASCII schema
 * identifiers. Types only — no validation logic lives here (the validator is
 * a later round; see ValidationReport below for its output contract).
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Semantic version string, e.g. "1.0.0". */
export type Semver = string

/**
 * Parameter definition used by action-registry entries, rule predicates,
 * sequence steps, and matrix effects.
 *
 * SPEC-DEFECT: the spec references `param_def[]` throughout the Mechanism
 * schemas but never formally defines the shape. This is the minimal shape
 * inferred from the Radio Cipher instantiation, where params are
 * `{name, type}` pairs with type values such as "string" and "int".
 */
export interface ParamDef {
  name: string
  type: string
}

/**
 * Open enum: keeps autocomplete for the known ids while allowing registry
 * extension (the co-play form catalog and its floor checks are open
 * registries per the spec — new forms register like new archetypes).
 */
type OpenId<Known extends string> = Known | (string & Record<never, never>)

// ---------------------------------------------------------------------------
// Co-play form catalog (spec Mechanism 2)
// ---------------------------------------------------------------------------

/** Seed co-play forms shipped with the catalog. The catalog is open. */
export type SeedCoPlayFormId =
  | 'hidden_info_coop'
  | 'co_build'
  | 'ai_performs_human_coaches'
  | 'rapport_contest'
  | 'ai_assistant'

export type CoPlayFormId = OpenId<SeedCoPlayFormId>

/** Universal validator checks — apply to every co-play form. */
export type UniversalCheckId =
  | 'schema_conformance'
  | 'solvability'
  | 'fairness'
  | 'budget_compliance'

/** Per-form validator floor checks for the seed catalog forms. */
export type SeedFormFloorCheckId =
  // hidden_info_coop
  | 'communication_completeness'
  | 'verbal_distinguishability'
  // co_build
  | 'goal_reachability'
  | 'progress_measurability'
  | 'construction_visibility'
  // ai_performs_human_coaches
  | 'coaching_effectiveness'
  | 'solvability_under_coaching'
  // rapport_contest
  | 'sync_metric_computability'
  | 'answer_space_symmetry'
  // ai_assistant
  | 'base_solvability'
  | 'assist_value_measurability'

/** Check id — open, since newly registered forms bring new floor checks. */
export type CheckId = OpenId<UniversalCheckId | SeedFormFloorCheckId>

/** One entry of the co-play form registry: form id → activated floor checks. */
export interface CoPlayFormDefinition {
  id: CoPlayFormId
  floor_checks: readonly CheckId[]
}

export type CoPlayFormCatalog = readonly CoPlayFormDefinition[]

/**
 * Co-play forms whose floor checks REQUIRE an information partition:
 * hidden_info_coop's floors (communication_completeness /
 * verbal_distinguishability's cross-role model) are meaningless without the
 * template's role visibility, rule visibility, channels, and action
 * capabilities. gametype_consistency rejects registration of these forms
 * without an information_partition_template; shared-state forms (co_build
 * etc.) may omit or simplify it (spec Mechanism 1). Registry constant — a
 * newly registered form that needs a partition adds itself here.
 */
export const PARTITION_REQUIRED_CO_PLAY_FORMS: readonly CoPlayFormId[] = ['hidden_info_coop']

/** Seed catalog per spec Mechanism 2 (form → validator floor checks). */
export const SEED_CO_PLAY_FORM_CATALOG: CoPlayFormCatalog = [
  {
    id: 'hidden_info_coop',
    floor_checks: ['communication_completeness', 'verbal_distinguishability'],
  },
  {
    id: 'co_build',
    floor_checks: ['goal_reachability', 'progress_measurability', 'construction_visibility'],
  },
  {
    id: 'ai_performs_human_coaches',
    floor_checks: ['coaching_effectiveness', 'solvability_under_coaching'],
  },
  { id: 'rapport_contest', floor_checks: ['sync_metric_computability', 'answer_space_symmetry'] },
  { id: 'ai_assistant', floor_checks: ['base_solvability', 'assist_value_measurability'] },
]

// ---------------------------------------------------------------------------
// ElementArchetype
// ---------------------------------------------------------------------------

export type ElementCategory = 'visual' | 'auditory' | 'spatial' | 'temporal' | 'hybrid'
export type InteractionModel = 'stateless' | 'stateful' | 'reactive'
export type AttributeType = 'enum' | 'range' | 'boolean' | 'set'
export type StateType = 'enum' | 'range'

export interface VerbalLabel {
  /** Canonical verbal name — unique reference for the archetype. */
  canonical: string
  /** Toned pinyin, the unit for auditory-distinguishability distance checks. */
  phonetic_pinyin: string
  aliases?: string[]
  forbidden_terms?: string[]
}

export interface AttributeDefinition {
  name: string
  type: AttributeType
  required: boolean
  /** Legal value set when type=enum. */
  values?: string[]
  /** ASCII value → target-language display label (type=enum). */
  display_labels?: Record<string, string>
  /** Lower bound when type=range. */
  min?: number
  /** Upper bound when type=range. */
  max?: number
  /** Step when type=range (continuous → discretized). */
  step?: number
  default?: unknown
  /** Verbal description template, e.g. "{color}色的{shape}". */
  verbal_template?: string
}

export interface StateDefinition {
  name: string
  type: StateType
  values?: string[]
  min?: number
  max?: number
  step?: number
  initial?: unknown
  verbal_template?: string
}

export interface ElementArchetype {
  id: string
  category: ElementCategory
  verbal_label: VerbalLabel
  description: string
  attributes: AttributeDefinition[]
  /** Possible runtime states (optional per spec). */
  states?: StateDefinition[]
  interaction_model: InteractionModel
}

// ---------------------------------------------------------------------------
// RuleTemplate — four declarative template kinds (discriminated union)
// ---------------------------------------------------------------------------

export type RuleTemplateKind =
  | 'condition_action'
  | 'state_transition'
  | 'temporal_sequence'
  | 'interaction_matrix'

export type Combinator = 'AND' | 'OR' | 'NOT'
export type SequenceOrdering = 'strict' | 'flexible'
export type RelationType = 'compatible' | 'incompatible' | 'synergy' | 'modifies' | 'neutral'

export interface PredicateDefinition {
  name: string
  params: ParamDef[]
  description: string
}

export interface ConditionSchema {
  predicates: PredicateDefinition[]
  combinators: Combinator[]
}

/** Action subset a condition_action template may trigger. */
export interface ActionSchema {
  /** References GameType.action_registry names with scope rule_verb|both. */
  verbs: string[]
}

export interface TransitionTableSchema {
  states: string[]
  events: string[]
}

export interface SequenceStepSchema {
  /** References an action_registry name. */
  action: string
  params: ParamDef[]
}

export interface SequenceSchema {
  max_steps: number
  step_schema: SequenceStepSchema
  ordering: SequenceOrdering
}

export interface MatrixEffectSchema {
  relation: string
  /** References an action_registry name. */
  effect: string
  params: ParamDef[]
}

export interface MatrixSchema {
  entity_types: string[]
  /**
   * Element attribute names carrying the entity type — an element's entity
   * type is the value of its first present attribute in this list (spec
   * Mechanism 1; e.g. botanical [species], sound-garden
   * [rhythm_type, melody_type]). The engine reads this declaration, never a
   * heuristic.
   */
  entity_type_attributes: string[]
  /**
   * Optional pair-eligibility filter: a target pair participates in the
   * matrix lookup only when both elements carry EQUAL values on every named
   * param (spec Mechanism 1; e.g. sound-garden [timeline_slot] — only
   * same-slot rhythm×melody pairs score). Omitted = all target pairs.
   */
  pair_match_attributes?: string[]
  relation_types: RelationType[]
  /**
   * Optional relation → score map: the machine scoring source for
   * score_threshold GameTypes (spec Mechanism 1). The engine sums eligible
   * pairs' matrix relations through this map.
   */
  relation_scores?: Record<string, number>
  effect_schema: MatrixEffectSchema[]
}

interface RuleTemplateBase {
  id: string
  /**
   * Template-level declared weight: how many communication round trips
   * executing this rule costs against the communication budget.
   */
  communication_weight: number
}

export interface ConditionActionRuleTemplate extends RuleTemplateBase {
  type: 'condition_action'
  condition_schema: ConditionSchema
  action_schema: ActionSchema
}

export interface StateTransitionRuleTemplate extends RuleTemplateBase {
  type: 'state_transition'
  transition_table_schema: TransitionTableSchema
}

export interface TemporalSequenceRuleTemplate extends RuleTemplateBase {
  type: 'temporal_sequence'
  sequence_schema: SequenceSchema
}

export interface InteractionMatrixRuleTemplate extends RuleTemplateBase {
  type: 'interaction_matrix'
  matrix_schema: MatrixSchema
}

export type RuleTemplate =
  | ConditionActionRuleTemplate
  | StateTransitionRuleTemplate
  | TemporalSequenceRuleTemplate
  | InteractionMatrixRuleTemplate

// ---------------------------------------------------------------------------
// InformationPartitionTemplate
// ---------------------------------------------------------------------------

export type InputModality = 'visual' | 'auditory' | 'tactile' | 'mixed'
export type OutputModality = 'voice' | 'gesture' | 'action' | 'mixed'
export type ChannelModality = 'voice' | 'text' | 'structured_signal'

export type PartitionPattern =
  | 'dual_half'
  | 'know_unknown'
  | 'restricted_clue'
  | 'ability_complement'
  | 'describe_execute'
  | 'sequential_reveal'

export interface RoleDefinition {
  id: string
  display_name: string
  verbal_label: string
  description: string
  input_modality: InputModality
  output_modality: OutputModality
}

/** Role-observable element fields ("*" wildcards allowed per spec). */
export interface FieldVisibility {
  element_archetype: string
  attributes: string[]
  states: string[]
}

export interface VisibilityRule {
  role: string
  can_see: FieldVisibility[]
  cannot_see: FieldVisibility[]
}

export interface RuleVisibility {
  role: string
  /** Visible RuleTemplate ids ("*" = all). */
  visible_rule_templates: string[]
}

/**
 * Cross-role shared reference label source. Only archetypes that need
 * cross-role verbal communication are listed; the attributes must be in
 * every communicating role's can_see set (gametype_consistency gate).
 */
export interface SharedLabelAttributes {
  element_archetype: string
  attributes: string[]
}

export interface ActionCapability {
  role: string
  /** Performable action verbs (references action_registry names). */
  can_perform: string[]
  /** Element archetype ids this role can act on. */
  target_archetypes: string[]
}

export interface ChannelConstraints {
  max_words_per_turn?: number
  forbidden_content?: string[]
  turn_time_limit_seconds?: number
}

export interface CommunicationChannel {
  from: string
  to: string
  modality: ChannelModality
  constraints: ChannelConstraints
}

export interface InformationPartitionTemplate {
  roles: RoleDefinition[]
  visibility_rules: VisibilityRule[]
  rule_visibility: RuleVisibility[]
  shared_label_attributes: SharedLabelAttributes[]
  action_capability: ActionCapability[]
  communication_channels: CommunicationChannel[]
  partition_pattern: PartitionPattern
}

// ---------------------------------------------------------------------------
// GameType
// ---------------------------------------------------------------------------

export type WinConditionTypeId = 'all_solved' | 'score_threshold' | 'optimization_target'
export type ActionScope = 'rule_verb' | 'player_action' | 'both'

/**
 * Declarative effect of an action on a stateful target element's FIRST
 * declared state machine (spec Mechanism 1): advance one position along the
 * declared value order, jump to the terminal value, or no effect (default).
 */
export type StateEffect = 'advance_state' | 'complete_state' | 'none'

/**
 * Declarative construction effect on the Level.initial_state construction
 * model (spec Mechanism 1): place = put the target element on its declared
 * slot, remove = take it off. co_build placement actions declare this; the
 * engine and the solver both execute it.
 */
export type ConstructionEffect = 'place' | 'remove'

export interface WinConditionType {
  type: WinConditionTypeId
  description: string
}

/** One entry of the GameType-global action verb registry. */
export interface ActionDefinition {
  name: string
  description: string
  params: ParamDef[]
  scope: ActionScope
  /** Optional declarative state effect; the rule engine executes it. */
  state_effect?: StateEffect
  /** Optional declarative construction effect (co_build placement actions). */
  construction_effect?: ConstructionEffect
  /**
   * Optional rule-template trigger bindings: the ids of the condition_action
   * / temporal_sequence / interaction_matrix templates this player action
   * fires. A rule of those three kinds fires only when the action actually
   * performed lists its template here — completing the action-gating
   * discipline state_transition already gets from action_event_mapping, so an
   * unrelated poke (a pure-communication action) can never advance game
   * state. state_transition templates are driven by action_event_mapping
   * events, NOT by this field (gametype_consistency rejects a state_transition
   * id here as a silent no-op). Empty/absent = a pure-communication action
   * that triggers no rule.
   */
  triggers?: string[]
}

export interface DifficultyBudget {
  element_count: { min: number; max: number }
  rule_count: { min: number; max: number }
  partition_complexity: { max: number }
  weights: { element: number; rule: number; partition: number }
  total_score: { min: number; max: number }
}

export interface CommunicationBudget {
  max_round_trips: number
  estimated_seconds_per_round: number
  time_limit_seconds: number
  safety_margin: number
  // Feasibility rule: round_trips * seconds_per_round <= time_limit * safety_margin
}

/**
 * One row of the optional action_event_mapping table: `action_type` plus
 * `<rule_template_id>_event` columns (e.g. health_response_event). ONLY the
 * `_event` columns are machine-consumed (see rules.ts producibleEvents /
 * actionEvent); the open Record type permits other columns, but any
 * non-event column carries no current machine semantics (illustrative only).
 */
export type ActionEventMappingEntry = { action_type: string } & Record<string, string>

export interface GameType {
  /** Unique id, kebab-case. */
  id: string
  version: Semver
  display_name: string
  description: string
  element_archetypes: ElementArchetype[]
  rule_templates: RuleTemplate[]
  /** Exactly one primary co-play form — decides the validator floor checks. */
  co_play_form: CoPlayFormId
  /**
   * Heavily used by hidden_info_coop; other forms may simplify or omit it
   * (e.g. co_build shares all state, the partition degenerates to symmetric
   * visibility) — hence optional.
   */
  information_partition_template?: InformationPartitionTemplate
  win_condition_type: WinConditionType
  difficulty_budget: DifficultyBudget
  action_registry: ActionDefinition[]
  /**
   * Optional player-action → rule-event mapping table (GameTypes with
   * state_transition rules use it; spec Mechanism 1). Each row's
   * action_type carries one or more `<rule_template_id>_event` columns —
   * the sole machine-consumed columns; the engine and solver translate a
   * player action into the named event for each state_transition template.
   */
  action_event_mapping?: ActionEventMappingEntry[]
  communication_budget: CommunicationBudget
  /**
   * Solvability solver strategy id (e.g. "exhaustive_path_search", "csp").
   * Every GameType must declare one (spec Mechanism 3, solvability
   * computability assumption).
   */
  solver_strategy: string
  /** Solvability solver timeout upper bound in milliseconds. */
  solver_timeout_ms: number
}

// ---------------------------------------------------------------------------
// Level
// ---------------------------------------------------------------------------

export type Feasibility = 'feasible' | 'tight' | 'infeasible'

export interface LevelMetadata {
  id: string
  /** References GameType.id. */
  game_type: string
  /** References GameType.version — exact version binding. */
  game_type_version: Semver
  title: string
  author: string
  created_at: string
}

/** Actual complexity values (must fall within GameType.difficulty_budget). */
export interface LevelDifficulty {
  element_count: number
  rule_count: number
  partition_complexity: number
  total_score: number
}

export interface CommunicationEstimate {
  round_trips: number
  /**
   * Optional coordination rounds beyond rule evaluation (co_build
   * proposal / division-of-labor turns) — included in the round_trips
   * derivation (spec Mechanism 4).
   */
  coordination_round_trips?: number
  estimated_seconds: number
  time_limit_seconds: number
  feasibility: Feasibility
}

/**
 * co_build construction model: the starting space (spec Mechanism 1;
 * goal_reachability's machine-derivation input). The timeline_slots field
 * name follows the sound-garden instantiation — generalized naming is
 * deferred to a second co_build instance (spec note).
 */
export interface InitialState {
  timeline_slots?: number
  /** Element instance ids already placed at start. */
  occupied: string[]
}

/** One material-pool entry: archetype + count + the type-carrying param(s). */
export type MaterialEntry = { archetype: string; count: number } & Record<string, unknown>

export type ElementPosition = { slot: number } | { x: number; y: number }

export interface LevelElement {
  id: string
  /** References ElementArchetype.id. */
  archetype: string
  /**
   * Attribute values for this instance (must be within the archetype's
   * attribute definitions). Kept flat: Level → elements[] → params{} is the
   * third and deepest nesting level allowed for AI-authored content.
   */
  params: Record<string, unknown>
  /**
   * Optional per-instance starting state overrides (spec Mechanism 1). Each
   * key names a declared state of the archetype; the value replaces that
   * state's archetype `initial` for THIS instance (e.g. a plant's health or
   * inherited effective_light). Omitted states fall back to the archetype
   * initial.
   */
  initial_states?: Record<string, unknown>
  position?: ElementPosition
}

export interface LevelRule {
  id: string
  /** References RuleTemplate.id. */
  template: string
  bindings: Record<string, unknown>
  /** Element instance ids this rule acts on. */
  target_elements: string[]
}

export interface ElementView {
  element_id: string
  visible_attributes: string[]
  visible_states: string[]
}

export interface RoleAssignment {
  role: string
  element_views: ElementView[]
}

export interface LevelInformationPartition {
  role_assignments: RoleAssignment[]
}

export interface WinCondition {
  /** References GameType.win_condition_type. */
  type: string
  params: Record<string, unknown>
}

/** optimization_target: every element with `state` must rank >= `value`. */
export interface StateAtLeastConstraint {
  state: string
  value: string
}

/** optimization_target: at least `count` elements have `state` == `value`. */
export interface StateCountConstraint {
  state: string
  value: string
  count: number
}

/**
 * Declarative optimization_target params (spec Mechanism 1, formalized R7):
 * a conjunction of "every element with this state ranks at least X" and
 * "at least N elements reach state == Y" constraints, ranked by each
 * state's declared value order. Game-agnostic — no hardcoded state names.
 */
export interface OptimizationTargetParams {
  all_states_at_least?: StateAtLeastConstraint[]
  count_states_equal?: StateCountConstraint[]
}

export interface Level {
  metadata: LevelMetadata
  difficulty: LevelDifficulty
  communication_estimate: CommunicationEstimate
  /** Optional co_build construction model (see InitialState). */
  initial_state?: InitialState
  /** Optional per-role material pools (goal_reachability input). */
  available_materials?: Record<string, MaterialEntry[]>
  elements: LevelElement[]
  rules: LevelRule[]
  information_partition: LevelInformationPartition
  win_condition: WinCondition
  /**
   * Optional — auto-generated for hidden_info_coop (surface generation
   * contract); shared-state forms may omit or generate symmetric surfaces.
   */
  communication_surfaces?: CommunicationSurface[]
}

// ---------------------------------------------------------------------------
// CommunicationSurface (spec Mechanism 3 — surface generation contract)
// ---------------------------------------------------------------------------

export type SurfaceType = 'structured_description' | 'reference_manual' | 'audio_cue_list'
export type WorkflowAction = 'describe_state' | 'request_info' | 'give_instruction' | 'execute'

export interface SurfaceElementVisible {
  element_id: string
  /** Archetype-level verbal label (e.g. 「密文段」). */
  archetype_label: string
  /**
   * Instance-level unique verbal reference, rendered from the
   * shared_label_attributes verbal_template (e.g. 「短密文段」).
   */
  instance_label: string
  visible_attributes?: Record<string, unknown>
  visible_states?: Record<string, unknown>
}

export interface SurfaceRuleVisible {
  rule_id: string
  /** Natural-language description auto-translated from the declarative rule. */
  description: string
  relevant_elements: string[]
}

export interface SurfaceAction {
  action: string
  description: string
  target_elements: string[]
}

export interface WorkflowStep {
  step: number
  action: WorkflowAction
  description: string
}

export interface CommunicationProtocol {
  partner_role: string
  /** Channel constraints from the partition template. */
  channel_constraints?: ChannelConstraints
  suggested_workflow: WorkflowStep[]
}

export interface SurfaceContent {
  elements_visible: SurfaceElementVisible[]
  rules_visible: SurfaceRuleVisible[]
  action_vocabulary: SurfaceAction[]
  communication_protocol: CommunicationProtocol
}

export interface CommunicationSurface {
  /** Target role id. */
  role: string
  game_type: string
  /** Version binding — must equal the Level's game_type_version. */
  game_type_version: Semver
  surface_type: SurfaceType
  content: SurfaceContent
}

// ---------------------------------------------------------------------------
// Validator output contract (spec Mechanism 3 — validator interface).
// Types only; the validator implementation is a later round.
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'fail' | 'warn'

/**
 * Per-check verdict — the spec enum (pass|fail|warn) extended with 'skipped'
 * for floor checks that are catalog-registered but not yet implemented.
 * 'skipped' is never treated as pass: it is excluded from overall_verdict
 * aggregation, and publish gating must treat a skipped floor check as
 * not-yet-passed (spec invariant: publish requires ALL floor checks to pass).
 */
export type CheckVerdict = Verdict | 'skipped'

export type ViolationSeverity = 'error' | 'warning'

export interface Violation {
  severity: ViolationSeverity
  /**
   * REQUIRED (spec invariant): path locating the offending field,
   * e.g. "elements[2].params.color".
   */
  field_path: string
  /** Which constraint was violated, e.g. "enum_membership". */
  constraint: string
  /** Expected value or range. */
  expected: string
  /** Actual value. */
  actual: string
  /** REQUIRED (spec invariant): fix suggestion for AI consumption. */
  suggestion: string
  /** Related element ids (cross-element violations). */
  related_elements?: string[]
}

export interface CheckResult {
  /**
   * Universal checks always apply; form floor checks are activated by the
   * GameType's co_play_form (see SEED_CO_PLAY_FORM_CATALOG). The enum is
   * extended when new forms register.
   */
  check_type: CheckId
  verdict: CheckVerdict
  /** Non-empty only when verdict is fail|warn. */
  violations: Violation[]
}

export interface ValidationReport {
  level_id: string
  game_type: string
  game_type_version: Semver
  /** Never 'pass' while any activated floor check is skipped (capped at 'warn'). */
  overall_verdict: Verdict
  /**
   * True only when every universal check AND every activated floor check is
   * a literal 'pass'. The publish gate reads this field; a skipped floor
   * check keeps it false (skipped ≠ passed).
   */
  publish_ready: boolean
  checks: CheckResult[]
}

/** Alias — the spec names this shape ValidationReport. */
export type ValidationResult = ValidationReport
