/**
 * Botanical manual RENDERER (L2 design §4a). A PURE function turning a Level's
 * declarative rule bindings + the GameType vocabulary into ONE addressable,
 * human-readable Chinese care manual — the single artifact projected two ways:
 *   - toManualData() → the platform-ai contract's ManualData (AI botanist)
 *   - ManualPanel     → a dev-viewable HTML surface (botanist-side inspection)
 *
 * Data-driven: every section's CONTENT (species, preconditions, transitions,
 * matrix relations, timings, win/lose) is read from the bindings / vocabulary,
 * never hardcoded prose. The renderer knows it is the *botanical* manual (it
 * groups by this game's concepts), but it classifies rules by template KIND +
 * which plant state a transition mutates — not by template id — so a renamed
 * template or an added enum value keeps working. Golden tests pin the current
 * fixture's exact output.
 */
import type { GameType, Level, LevelElement, LevelRule, TimedEmitter } from '@amiclaw/creation'
import type { ManualData } from '@amiclaw/platform-ai/contract'
import { CARE_VERBS } from '@/game/care-verbs'
import { GROWTH_LABEL, HEALTH_LABEL, LIGHT_LABEL } from '@/game/visual-map'
import {
  ACTION_LABEL,
  FIELD_LABEL,
  RELATION_LABEL,
  SOIL_LABEL,
  STATE_NAME_LABEL,
} from './manual-labels'

export interface RenderedManualSection {
  id: string
  title: string
  lines: string[]
}

export interface RenderedManual {
  version: string
  sections: RenderedManualSection[]
}

// --- vocabulary helpers (all data-driven from the GameType) -----------------

function plantArchetype(gameType: GameType) {
  return gameType.element_archetypes.find((a) => a.id === 'plant')
}

function speciesLabel(gameType: GameType, species: string): string {
  const attr = plantArchetype(gameType)?.attributes.find((a) => a.name === 'species')
  return attr?.display_labels?.[species] ?? species
}

/** Chinese label for a state/attribute enum VALUE (label falls back to ASCII). */
function valueLabel(gameType: GameType, field: string, value: string): string {
  switch (field) {
    case 'species':
      return speciesLabel(gameType, value)
    case 'effective_light':
    case 'light_level':
      return LIGHT_LABEL[value] ?? value
    case 'growth_stage':
      return GROWTH_LABEL[value] ?? value
    case 'health':
      return HEALTH_LABEL[value] ?? value
    case 'soil_type':
      return SOIL_LABEL[value] ?? value
    default:
      return value
  }
}

/** `label（ascii）` — the Chinese gloss plus the engine value for AI grounding. */
function gloss(gameType: GameType, field: string, value: string): string {
  return `${valueLabel(gameType, field, value)}（${value}）`
}

/** state-value order (worst → best) for a plant state, read from the archetype. */
function stateOrder(gameType: GameType, stateName: string): string[] {
  return plantArchetype(gameType)?.states?.find((s) => s.name === stateName)?.values ?? []
}

/** event → action_type reverse map from action_event_mapping (`<tpl>_event` cols). */
function eventToAction(gameType: GameType): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of gameType.action_event_mapping ?? []) {
    for (const [key, value] of Object.entries(row)) {
      if (key.endsWith('_event') && typeof value === 'string') map.set(value, row.action_type)
    }
  }
  return map
}

/** The player verb (or "无人照料") that drives a transition event. */
function eventVerbLabel(eventToActionMap: Map<string, string>, event: string): string {
  const action = eventToActionMap.get(event)
  if (action === undefined) return '无人照料'
  return ACTION_LABEL[action] ?? action
}

/**
 * Events the level can ACTUALLY emit — the only ones the manual should document.
 * An event is emittable if a PLAYER-usable action_type reaches it via
 * action_event_mapping (the shipped care verbs are the source of "player-usable";
 * `overwater`→`wrong_care` is NOT among them, so tutorial harm the player can
 * never cause is dropped), OR a timed emitter fires it (decay `neglect`).
 */
function emittableEvents(gameType: GameType): Set<string> {
  const playerActionTypes = new Set(CARE_VERBS.map((v) => v.actionType))
  const events = new Set<string>()
  for (const row of gameType.action_event_mapping ?? []) {
    if (!playerActionTypes.has(row.action_type)) continue
    for (const [key, value] of Object.entries(row)) {
      if (key.endsWith('_event') && typeof value === 'string') events.add(value)
    }
  }
  for (const emitter of gameType.timed_emitters ?? []) events.add(emitter.event)
  return events
}

/**
 * True when a compatibility relation binds an effect that carries a `state_effect`
 * (its effect verb ADVANCES a state) — i.e. the relation MECHANICALLY changes play
 * (synergy→heal here) rather than being informational strategy-reference only.
 */
function relationIsActive(gameType: GameType, relation: string): boolean {
  const template = gameType.rule_templates.find((t) => t.type === 'interaction_matrix') as
    | { matrix_schema?: { effect_schema?: Array<{ relation: string; effect: string }> } }
    | undefined
  const effect = template?.matrix_schema?.effect_schema?.find((e) => e.relation === relation)
  if (effect === undefined) return false
  const action = gameType.action_registry.find((a) => a.name === effect.effect)
  return action?.state_effect === 'advance_state' || action?.state_effect === 'complete_state'
}

/** Elements a timed emitter targets (archetype-scoped, or by target_template rule). */
function emitterTargetElements(level: Level, emitter: TimedEmitter): LevelElement[] {
  if (emitter.target.kind === 'archetype') {
    const archetype = emitter.target.archetype
    return level.elements.filter((e) => e.archetype === archetype)
  }
  const ids = new Set<string>()
  for (const rule of level.rules) {
    if (rule.template === emitter.target_template)
      for (const id of rule.target_elements) ids.add(id)
  }
  return level.elements.filter((e) => ids.has(e.id))
}

/**
 * Effective per-instance decay intervals across an emitter's targeted elements,
 * folding in each element's `initial_timers[emitter.id].interval_ms` override (as
 * the engine + the on-screen ring do). Returns the min/max (ms) and the species
 * on the fastest interval, so the manual reports the real pacing — including
 * bg-standard-001's orchid at 40s, not the base 60s.
 */
function effectiveDecayIntervals(
  level: Level,
  emitter: TimedEmitter
): { minMs: number; maxMs: number; fastestSpecies: string[] } {
  const entries = emitterTargetElements(level, emitter).map((el) => {
    const override = el.initial_timers?.[emitter.id]?.interval_ms
    return {
      species: String(el.params.species ?? ''),
      intervalMs: typeof override === 'number' ? override : emitter.interval_ms,
    }
  })
  const intervals = entries.map((e) => e.intervalMs)
  const minMs = Math.min(...intervals)
  const maxMs = Math.max(...intervals)
  const fastestSpecies = [
    ...new Set(entries.filter((e) => e.intervalMs === minMs).map((e) => e.species)),
  ]
  return { minMs, maxMs, fastestSpecies }
}

// --- rule kind + binding narrowing ------------------------------------------

type Transition = [string, string, string]
type MatrixRow = [string, string, string]

function templateKind(gameType: GameType, rule: LevelRule): string | undefined {
  return gameType.rule_templates.find((t) => t.id === rule.template)?.type
}

function transitionsOf(rule: LevelRule): Transition[] {
  const t = (rule.bindings as { transitions?: unknown }).transitions
  return Array.isArray(t) ? (t as Transition[]) : []
}

function matrixOf(rule: LevelRule): MatrixRow[] {
  const m = (rule.bindings as { matrix?: unknown }).matrix
  return Array.isArray(m) ? (m as MatrixRow[]) : []
}

interface ParsedNeeds {
  species: string | null
  conditions: { field: string; value: string }[]
  combinator: string
  verb: string
}

function parseNeeds(rule: LevelRule): ParsedNeeds {
  const b = rule.bindings as {
    predicates?: Array<Record<string, string>>
    combinator?: string
    action?: { verb?: string }
  }
  let species: string | null = null
  const conditions: { field: string; value: string }[] = []
  for (const pred of b.predicates ?? []) {
    const field = Object.keys(pred).find((k) => k !== 'name')
    if (field === undefined) continue
    const value = pred[field]
    if (field === 'species') species = value
    else conditions.push({ field, value })
  }
  return {
    species,
    conditions,
    combinator: b.combinator ?? 'AND',
    verb: b.action?.verb ?? '',
  }
}

/** Which plant state a state_transition rule mutates (matched by from-values). */
function transitionField(gameType: GameType, transitions: Transition[]): string | null {
  const froms = transitions.map((t) => t[0])
  if (froms.length === 0) return null
  for (const state of plantArchetype(gameType)?.states ?? []) {
    if (froms.every((f) => state.values?.includes(f))) return state.name
  }
  return null
}

// --- section builders -------------------------------------------------------

function joinConditions(gameType: GameType, parsed: ParsedNeeds): string {
  const parts = parsed.conditions.map(
    (c) => `${FIELD_LABEL[c.field] ?? c.field}为${gloss(gameType, c.field, c.value)}`
  )
  const sep = parsed.combinator === 'OR' ? '或' : '且'
  const joined = parts.join(sep)
  return parsed.combinator === 'NOT' ? `非（${joined}）` : joined
}

function objectiveSection(gameType: GameType, level: Level): RenderedManualSection {
  const lines: string[] = []
  const win = level.win_condition.params as {
    all_states_at_least?: { state: string; value: string }[]
    count_states_equal?: { state: string; value: string; count: number }[]
  }
  const clauses: string[] = []
  for (const c of win.all_states_at_least ?? [])
    clauses.push(
      `所有植株的${STATE_NAME_LABEL[c.state] ?? c.state}至少达到「${gloss(gameType, c.state, c.value)}」`
    )
  for (const c of win.count_states_equal ?? [])
    clauses.push(
      `至少 ${c.count} 株的${STATE_NAME_LABEL[c.state] ?? c.state}达到「${gloss(gameType, c.state, c.value)}」`
    )
  if (clauses.length > 0) lines.push(`达成目标：${clauses.join('，且')}。`)

  const lose = level.lose_condition?.params as { state?: string; value?: string } | undefined
  if (lose?.state && lose.value)
    lines.push(
      `败局：任一植株的${STATE_NAME_LABEL[lose.state] ?? lose.state}跌至「${gloss(gameType, lose.state, lose.value)}」即告失败；枯死无法挽回。`
    )
  return { id: 'objective', title: '目标与败局', lines }
}

function compatibilitySection(gameType: GameType, rows: MatrixRow[]): RenderedManualSection {
  // A relation with an active state_effect (synergy→heal) gets its mechanical
  // consequence spelled out; relations without one keep the strategic-reference
  // framing carried by the lead line.
  const lines = ['植株间的相性（未注明机械效果的仅供策略参考）：']
  for (const [a, b, relation] of rows) {
    const base = `${gloss(gameType, 'species', a)} 与 ${gloss(gameType, 'species', b)}：${RELATION_LABEL[relation] ?? relation}（${relation}）`
    lines.push(
      relationIsActive(gameType, relation) ? `${base}，养护任一株会同时治愈相邻的另一株。` : base
    )
  }
  return { id: 'compatibility', title: '相生相克', lines }
}

function lightSection(
  gameType: GameType,
  transitions: Transition[],
  e2a: Map<string, string>
): RenderedManualSection {
  const lines = ['调节光照可改变植株的实际光照：']
  for (const [from, event, to] of transitions)
    lines.push(
      `${valueLabel(gameType, 'effective_light', from)}经${eventVerbLabel(e2a, event)}变为${valueLabel(gameType, 'effective_light', to)}`
    )
  return { id: 'light', title: '光照调节', lines }
}

function growthSection(
  gameType: GameType,
  transitions: Transition[],
  e2a: Map<string, string>
): RenderedManualSection {
  const lines = ['养护得当可推进生长阶段：']
  for (const [from, event, to] of transitions)
    lines.push(
      `${valueLabel(gameType, 'growth_stage', from)}经${eventVerbLabel(e2a, event)}变为${valueLabel(gameType, 'growth_stage', to)}`
    )
  return { id: 'growth', title: '生长阶段', lines }
}

/** One health_response rule with the species it targets (for honest scoping). */
interface HealthRule {
  species: string[]
  transitions: Transition[]
}

/** Distinct species of a rule's target elements, first-seen order. */
function speciesOfElements(level: Level, elementIds: string[]): string[] {
  const out: string[] = []
  for (const id of elementIds) {
    const species = level.elements.find((e) => e.id === id)?.params.species
    if (typeof species === 'string' && !out.includes(species)) out.push(species)
  }
  return out
}

/**
 * A heal that is gated on a light level can become an IRREVERSIBLE LOCKOUT: if
 * the light ladder lets you shade PAST the heal light (a transition moves light
 * off the heal condition) and no transition returns to it, over-shading strands
 * the plant where its heal rule never fires again — and no verb raises light.
 * The botanist MUST warn about this. Returns the warning line, or null when the
 * heal light cannot be over-shaded or the move is reversible.
 */
function lightLockoutWarning(
  gameType: GameType,
  parsed: ParsedNeeds,
  lightTransitions: Transition[],
  e2a: Map<string, string>
): string | null {
  const lightCond = parsed.conditions.find(
    (c) => c.field === 'effective_light' || c.field === 'light_level'
  )
  if (parsed.species === null || lightCond === undefined) return null
  const healLight = lightCond.value
  const overShade = lightTransitions.filter(([from]) => from === healLight)
  if (overShade.length === 0) return null // the heal light cannot be shaded past
  const overTargets = overShade.map(([, , to]) => to)
  const reversible = lightTransitions.some(
    ([from, , to]) => to === healLight && overTargets.includes(from)
  )
  if (reversible) return null
  const verb = eventVerbLabel(e2a, overShade[0][1])
  const deepest = gloss(gameType, 'effective_light', overTargets[overTargets.length - 1])
  const sp = gloss(gameType, 'species', parsed.species)
  return `${verb}只会让光照逐级变暗、无法回退；一旦${sp}被${verb}到${deepest}，就再也无法恢复健康，切勿${verb}过头。`
}

/**
 * A per-species care section for a heal needs-rule. When the species heals ONLY
 * through this (light-)conditioned rule (no watering path), the condition is the
 * ONLY way back to health, so it is stated as such and the irreversible-lockout
 * warning is attached. When the species ALSO water-heals, the conditioned heal
 * is one additional path and the milder phrasing is used (no lockout: watering
 * still recovers it).
 */
function speciesCareSection(
  gameType: GameType,
  parsed: ParsedNeeds,
  waterHeals: boolean,
  lightTransitions: Transition[],
  e2a: Map<string, string>
): RenderedManualSection {
  const species = parsed.species as string
  const sp = gloss(gameType, 'species', species)
  const conditions = joinConditions(gameType, parsed)
  const lines: string[] = []
  if (parsed.conditions.length === 0) {
    lines.push(`养护${sp}可使其恢复健康。`)
  } else if (waterHeals) {
    lines.push(`当${conditions}时，养护${sp}可使其恢复健康。`)
  } else {
    lines.push(`${sp}只有在${conditions}时，养护才能使其恢复健康。`)
    const warning = lightLockoutWarning(gameType, parsed, lightTransitions, e2a)
    if (warning) lines.push(warning)
  }
  return {
    id: `species_care:${species}`,
    title: `${speciesLabel(gameType, species)} · 养护要点`,
    lines,
  }
}

function healthSection(
  gameType: GameType,
  level: Level,
  rules: HealthRule[],
  e2a: Map<string, string>
): RenderedManualSection {
  const order = stateOrder(gameType, 'health')
  const rank = (v: string) => order.indexOf(v)
  const lines: string[] = []
  if (order.length > 0)
    lines.push(`健康档位由差到好：${order.map((v) => gloss(gameType, 'health', v)).join(' < ')}。`)

  // Every species any health rule covers (first-seen order) — the denominator
  // for "does this event apply to ALL plants, or only some?".
  const allSpecies: string[] = []
  for (const r of rules) for (const s of r.species) if (!allSpecies.includes(s)) allSpecies.push(s)

  // Per event (first-seen order): the species it affects + its deduped ladder.
  const eventOrder: string[] = []
  const eventSpecies = new Map<string, Set<string>>()
  const eventLadder = new Map<string, Transition[]>()
  for (const r of rules) {
    for (const t of r.transitions) {
      const ev = t[1]
      if (!eventSpecies.has(ev)) {
        eventOrder.push(ev)
        eventSpecies.set(ev, new Set())
        eventLadder.set(ev, [])
      }
      for (const s of r.species) eventSpecies.get(ev)!.add(s)
      const ladder = eventLadder.get(ev)!
      if (!ladder.some((x) => x.join('|') === t.join('|'))) ladder.push(t)
    }
  }

  for (const ev of eventOrder) {
    const speciesSet = eventSpecies.get(ev)!
    const ladder = eventLadder.get(ev)!
    const ladderStr = ladder
      .map(
        ([f, , t]) => `${valueLabel(gameType, 'health', f)}→${valueLabel(gameType, 'health', t)}`
      )
      .join('；')
    const verb = eventVerbLabel(e2a, ev)
    const reachesDead = ladder.some(([, , t]) => t === 'dead')
    const deltas = ladder.map(([f, , t]) => rank(t) - rank(f))
    const dir: 'decay' | 'up' | 'down' | 'mixed' = reachesDead
      ? 'decay'
      : deltas.every((d) => d > 0)
        ? 'up'
        : deltas.every((d) => d < 0)
          ? 'down'
          : 'mixed'
    const universalEffect = {
      decay: '会随时间衰退',
      up: '可提升健康',
      down: '会降低健康',
      mixed: '会改变健康',
    }[dir]

    // Decay (reaches dead) is universal — every plant decays. An event that
    // covers every health-tracked species is universal too. OTHERWISE scope it
    // honestly to the species it affects and NAME the ones it does not (the fix
    // for the false "watering heals every plant" claim: shade-only plants get no
    // correct_care and must not be swept into a universal heal line).
    const coversAll = allSpecies.every((s) => speciesSet.has(s))
    if (dir === 'decay' || coversAll) {
      lines.push(`${verb}（${ev}）${universalEffect}：${ladderStr}。`)
    } else {
      const applies = allSpecies.filter((s) => speciesSet.has(s))
      const notApplies = allSpecies.filter((s) => !speciesSet.has(s))
      const appliesStr = applies.map((s) => gloss(gameType, 'species', s)).join('、')
      const scopedVerb = { up: '仅能提升', down: '仅会降低', mixed: '仅会改变' }[dir]
      let line = `${verb}（${ev}）${scopedVerb} ${appliesStr} 的健康：${ladderStr}。`
      if (notApplies.length > 0) {
        const notStr = notApplies.map((s) => gloss(gameType, 'species', s)).join('、')
        line += `${notStr}${verb}无效，恢复方式见各自养护要点。`
      }
      lines.push(line)
    }
  }

  for (const emitter of gameType.timed_emitters ?? []) {
    if (!eventSpecies.has(emitter.event)) continue
    // Report the EFFECTIVE per-instance pacing (folding in initial_timers
    // overrides) so the manual matches the on-screen decay ring — a uniform
    // value, or a range that names the fastest-decaying species.
    const { minMs, maxMs, fastestSpecies } = effectiveDecayIntervals(level, emitter)
    const minS = Math.round(minMs / 1000)
    const maxS = Math.round(maxMs / 1000)
    const warnS =
      emitter.warning_lead_ms !== undefined ? Math.round(emitter.warning_lead_ms / 1000) : 0
    const warnSuffix = warnS > 0 ? `，临近前 ${warnS} 秒会预警` : ''
    if (minS === maxS) {
      lines.push(`无人照料每约 ${minS} 秒衰退一次${warnSuffix}。`)
    } else {
      const fastestStr = fastestSpecies.map((s) => gloss(gameType, 'species', s)).join('、')
      lines.push(
        `无人照料每约 ${minS}–${maxS} 秒衰退一次，其中${fastestStr}最快（每约 ${minS} 秒）${warnSuffix}。`
      )
    }
  }
  lines.push('植株一旦枯死即无法挽回，并会导致败局。')
  return { id: 'health_and_decay', title: '健康与衰败', lines }
}

// --- top-level renderer -----------------------------------------------------

/**
 * Render the ONE botanical manual for a (GameType, Level) pair. Sections are
 * emitted only when the level actually carries the corresponding rules, in a
 * stable order: objective → per-species care → per-species danger →
 * compatibility → light → growth → health & decay. Rules are collected first,
 * then built, so a per-species care line can consult the light ladder (lockout)
 * and the health section can honestly scope which plants each event affects.
 */
export function renderBotanicalManual(gameType: GameType, level: Level): RenderedManual {
  const e2a = eventToAction(gameType)
  // Only document transition rows whose event this level can actually emit — a
  // manual that describes unreachable harm (tutorial `overwater`→`wrong_care`,
  // which no shipped verb produces) mis-advises the botanist.
  const emittable = emittableEvents(gameType)
  const needsRules: ParsedNeeds[] = []
  const matrixRows: MatrixRow[] = []
  const lightTransitions: Transition[] = []
  const growthTransitions: Transition[] = []
  const healthRules: HealthRule[] = []
  const seenLight = new Set<string>()
  const seenGrowth = new Set<string>()

  for (const rule of level.rules) {
    const kind = templateKind(gameType, rule)
    if (kind === 'condition_action') {
      const parsed = parseNeeds(rule)
      if (parsed.species !== null) needsRules.push(parsed)
    } else if (kind === 'interaction_matrix') {
      matrixRows.push(...matrixOf(rule))
    } else if (kind === 'state_transition') {
      const transitions = transitionsOf(rule).filter(([, event]) => emittable.has(event))
      const field = transitionField(gameType, transitions)
      if (field === 'effective_light') {
        for (const t of transitions) {
          const k = t.join('|')
          if (!seenLight.has(k)) {
            seenLight.add(k)
            lightTransitions.push(t)
          }
        }
      } else if (field === 'growth_stage') {
        for (const t of transitions) {
          const k = t.join('|')
          if (!seenGrowth.has(k)) {
            seenGrowth.add(k)
            growthTransitions.push(t)
          }
        }
      } else if (field === 'health') {
        healthRules.push({ species: speciesOfElements(level, rule.target_elements), transitions })
      }
    }
  }

  // Species that recover through WATERING (a health rule with a health-improving
  // event). A species healing only through a conditioned needs-rule (not here)
  // is the one an over-shade lockout can permanently strand.
  const healthRank = (v: string) => stateOrder(gameType, 'health').indexOf(v)
  const waterHealSpecies = new Set<string>()
  for (const r of healthRules) {
    if (r.transitions.some(([f, , t]) => healthRank(t) > healthRank(f))) {
      for (const s of r.species) waterHealSpecies.add(s)
    }
  }

  const care: RenderedManualSection[] = []
  const danger: RenderedManualSection[] = []
  for (const parsed of needsRules) {
    if (parsed.verb === 'heal') {
      care.push(
        speciesCareSection(
          gameType,
          parsed,
          waterHealSpecies.has(parsed.species as string),
          lightTransitions,
          e2a
        )
      )
    } else {
      const conditions = joinConditions(gameType, parsed)
      danger.push({
        id: `danger:${parsed.species}`,
        title: `${speciesLabel(gameType, parsed.species as string)} · 风险提示`,
        lines: [
          `当${conditions}时，${gloss(gameType, 'species', parsed.species as string)}会受损，应当避免。`,
        ],
      })
    }
  }

  const sections: RenderedManualSection[] = [objectiveSection(gameType, level), ...care, ...danger]
  if (matrixRows.length > 0) sections.push(compatibilitySection(gameType, matrixRows))
  if (lightTransitions.length > 0) sections.push(lightSection(gameType, lightTransitions, e2a))
  if (growthTransitions.length > 0) sections.push(growthSection(gameType, growthTransitions, e2a))
  if (healthRules.length > 0) sections.push(healthSection(gameType, level, healthRules, e2a))

  return { version: gameType.version, sections }
}

/**
 * Project the rendered manual into the platform-ai contract's ManualData:
 * addressable sections keyed by stable section id (consume-only shape). The
 * AI layer selects a subset of these keys by game state per turn.
 */
export function toManualData(rendered: RenderedManual): ManualData {
  return {
    version: rendered.version,
    sections: Object.fromEntries(rendered.sections.map((s) => [s.id, s])),
  }
}
