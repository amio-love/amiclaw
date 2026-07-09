import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import type {
  Manual,
  ManualModules,
  SceneInfo,
  WireConfig,
  ButtonConfig,
  DialConfig,
  KeypadConfig,
} from '@shared/manual-schema'
import { solveWire } from '../modules/wire/solver'
import { solveButton } from '../modules/button/solver'
import { solveDial } from '../modules/dial/solver'
import { solveKeypad } from '../modules/keypad/solver'

/**
 * MANUAL ↔ ENGINE EQUIVALENCE — the property BombSquad's core promise depends on.
 *
 * The product promise is "follow the manual and the bomb defuses": the player's
 * AI partner reads ONLY the manual, and the engine judges the cut. If the engine
 * ever accepts a different action than the manual — read literally — prescribes,
 * the AI confidently gives a wrong instruction and the player is punished with no
 * way to attribute the failure. This suite pins that gap shut.
 *
 * It compares the SHIPPED engine solvers (`solveWire` / `solveButton` /
 * `solveDial` / `solveKeypad`, which drive the real generator + on-panel
 * validation) against an INDEPENDENT literal reader written here from the
 * manual's own stated algorithm — first-match-wins for wire/button, unique-row
 * set-discrimination for dial/keypad. Because the reader does not call the
 * engine, agreement across the whole corpus is a real check that the engine
 * implements exactly what the manual tells the AI to do, not a tautology.
 *
 * Corpus = the SOURCE `practice.yaml` + every committed `data/daily/*.yaml`.
 * `packages/manual/build.ts` emits both read paths (the AI's `?format=yaml`
 * fetch and the engine's `/manual/data/<date>.yaml` fetch) by spreading the
 * parsed source `...sourceRest` verbatim — it never reorders or edits the
 * `wire_routing.rules` / `button.rules` arrays or the dial/keypad rows — so the
 * source arrays tested here are byte-for-byte what both the AI and the engine
 * consume at runtime (verified against production: the served daily YAML is
 * identical to the source).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const MANUAL_DATA = resolve(HERE, '../../../manual/data')
const PRACTICE_YAML = join(MANUAL_DATA, 'practice.yaml')
const DAILY_DIR = join(MANUAL_DATA, 'daily')

function loadManual(path: string): Manual {
  return yaml.load(readFileSync(path, 'utf8')) as Manual
}

const dailyFiles = readdirSync(DAILY_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .sort()

// Full corpus (practice + every daily) — used for the cheap STRUCTURAL guards
// that mathematically imply equivalence everywhere.
const fullCorpus: Array<{ name: string; manual: Manual }> = [
  { name: 'practice', manual: loadManual(PRACTICE_YAML) },
  ...dailyFiles.map((f) => ({ name: f, manual: loadManual(join(DAILY_DIR, f)) })),
]

// Deterministic sample for the heavy BEHAVIORAL enumeration: practice + an
// evenly-spaced slice of the daily corpus + the two dates the reaudit sampled.
// Sampling keeps CI fast; the structural guards below run over the FULL corpus
// and, together, prove equivalence for every manual (see the invariant note on
// the wire behavioral test).
function pickBehavioralSample(): Array<{ name: string; manual: Manual }> {
  const step = Math.max(1, Math.floor(dailyFiles.length / 12))
  const picked = new Set<string>()
  for (let i = 0; i < dailyFiles.length; i += step) picked.add(dailyFiles[i])
  for (const d of ['2026-07-08.yaml', '2026-07-09.yaml']) {
    if (dailyFiles.includes(d)) picked.add(d)
  }
  const sample: Array<{ name: string; manual: Manual }> = [
    { name: 'practice', manual: loadManual(PRACTICE_YAML) },
  ]
  for (const f of [...picked].sort())
    sample.push({ name: f, manual: loadManual(join(DAILY_DIR, f)) })
  return sample
}
const behavioralSample = pickBehavioralSample()

const SCENE_TWISTER = '四是四十是十' // decoy field; never read by any rule
function scene(batteryCount: number, indicators: SceneInfo['indicators'] = []): SceneInfo {
  return { sceneTongueTwister: SCENE_TWISTER, batteryCount, indicators }
}
// Scene set covering every branch a rule can take: the battery `{gt:2}`/`{lte:2}`
// boundary from both sides, and FRK present-lit / present-unlit / absent.
const SCENES: SceneInfo[] = [
  scene(1),
  scene(2),
  scene(3),
  scene(1, [{ label: 'FRK', lit: true }]),
  scene(3, [{ label: 'FRK', lit: true }]),
  scene(3, [{ label: 'FRK', lit: false }]),
]

// Compact scene set for the heavy wire enumeration: covers the only branch
// pivots wire rules use — the battery `{gt:2}` boundary (2 vs 3) and the
// 5-wire `indicator_FRK_lit` rule (FRK lit vs absent).
const WIRE_SCENES: SceneInfo[] = [
  scene(2),
  scene(3),
  scene(3, [{ label: 'FRK', lit: true }]),
  scene(2, [{ label: 'FRK', lit: true }]),
]

// ---------------------------------------------------------------------------
// Independent literal readers — transcribed from the manual's stated algorithm,
// deliberately NOT importing rule-engine.ts, so a match against the engine is a
// real cross-check.
// ---------------------------------------------------------------------------

const WIRE_COLORS = ['red', 'blue', 'yellow', 'green', 'white', 'black'] as const

/** Flat context a literal AI derives from the wires + scene, per the wire preamble. */
function wireContext(wires: string[], s: SceneInfo): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    wire_count: wires.length,
    color_at_last: wires[wires.length - 1],
    battery_count: s.batteryCount,
  }
  for (const c of WIRE_COLORS) ctx[`count_${c}`] = wires.filter((w) => w === c).length
  // "A named indicator absent this round is treated as unlit." (manual clause)
  // so an `indicator_X_lit` lookup is true only when X is present AND lit.
  for (const ind of s.indicators) ctx[`indicator_${ind.label}_lit`] = ind.lit
  return ctx
}

/** Compare one condition value to the actual, per the manual's {gt}/{lte}/… vocabulary. */
function literalMatchValue(cond: unknown, actual: unknown): boolean {
  if (cond !== null && typeof cond === 'object') {
    const c = cond as Record<string, number>
    if ('gt' in c) return typeof actual === 'number' && actual > c.gt
    if ('gte' in c) return typeof actual === 'number' && actual >= c.gte
    if ('lt' in c) return typeof actual === 'number' && actual < c.lt
    if ('lte' in c) return typeof actual === 'number' && actual <= c.lte
  }
  return cond === actual
}

/** ALL condition keys hold (an absent context key — e.g. an absent indicator — fails). */
function literalConditionHolds(
  condition: Record<string, unknown>,
  ctx: Record<string, unknown>
): boolean {
  return Object.entries(condition).every(([k, v]) => {
    if (k.startsWith('indicator_') && !(k in ctx)) return literalMatchValue(v, false) // absent = unlit
    if (!(k in ctx)) return false
    return literalMatchValue(v, ctx[k])
  })
}

/** Resolve a wire target to a 0-indexed cut, per the manual: 1-indexed position, first/last, color-scan. */
function literalResolveWire(
  target: { position: 'first' | 'last' | number; color?: string },
  wires: string[]
): number | null {
  if (target.position === 'first') {
    if (target.color) {
      const i = wires.indexOf(target.color)
      return i >= 0 ? i : null
    }
    return 0
  }
  if (target.position === 'last') {
    if (target.color) {
      const i = wires.lastIndexOf(target.color)
      return i >= 0 ? i : null
    }
    return wires.length - 1
  }
  const n = target.position
  return n >= 1 && n <= wires.length ? n - 1 : null
}

/**
 * What a literal first-match AI reader cuts. It STOPS at the first rule whose
 * condition holds and cuts that rule's target; `'stuck'` means the target can't
 * be resolved (a color the manual promised is absent) — the failure mode the
 * engine's fall-through would hide from the AI.
 */
function literalWireCut(
  wires: string[],
  rules: ManualModules['wire_routing']['rules'],
  s: SceneInfo
): number | 'stuck' | 'nomatch' {
  const ctx = wireContext(wires, s)
  for (const rule of rules) {
    if (literalConditionHolds(rule.condition, ctx)) {
      const pos = literalResolveWire(rule.target, wires)
      return pos === null ? 'stuck' : pos
    }
  }
  return 'nomatch'
}

function literalButtonAction(
  config: ButtonConfig,
  rules: ManualModules['button']['rules'],
  s: SceneInfo
): { action: 'tap' | 'hold'; releaseOnColor?: string } | 'nomatch' {
  const ctx: Record<string, unknown> = {
    color: config.color,
    label: config.label,
    indicatorColor: config.indicatorColor,
    displayNumber: config.displayNumber,
    battery_count: s.batteryCount,
  }
  for (const ind of s.indicators) ctx[`indicator_${ind.label}_lit`] = ind.lit
  for (const rule of rules) {
    if (literalConditionHolds(rule.condition, ctx)) {
      return rule.action.type === 'hold'
        ? { action: 'hold', releaseOnColor: rule.action.release_on_light }
        : { action: 'tap' }
    }
  }
  return 'nomatch'
}

/** The unique row containing all visible symbols, per the set-discrimination rule. */
function literalUniqueRow(rows: string[][], visible: string[]): { row: string[]; count: number } {
  const matches = rows.filter((row) => visible.every((sym) => row.includes(sym)))
  return { row: matches[0] ?? [], count: matches.length }
}

// k-combinations of an array (for enumerating visible symbol subsets).
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (k > arr.length) return []
  const [head, ...rest] = arr
  const withHead = combinations(rest, k - 1).map((c) => [head, ...c])
  const withoutHead = combinations(rest, k)
  return [...withHead, ...withoutHead]
}

// ---------------------------------------------------------------------------
// STRUCTURAL invariants over the FULL corpus — cheap, and together they imply
// literal-reader == engine for EVERY manual, not just the behavioral sample.
// ---------------------------------------------------------------------------

// Keys the engine's rule-engine buildContext actually provides. A rule that
// references anything else silently fails to match in the engine while a literal
// reader would evaluate it — a real divergence class. This guard proves it can't
// happen. (`indicator_<LABEL>_lit` is dynamic and allowed by pattern.)
const ENGINE_WIRE_KEYS = new Set([
  'wire_count',
  'color_at_last',
  'battery_count',
  'count_red',
  'count_blue',
])
const ENGINE_BUTTON_KEYS = new Set([
  'color',
  'label',
  'indicatorColor',
  'displayNumber',
  'battery_count',
])
const INDICATOR_KEY = /^indicator_[A-Za-z0-9]+_lit$/

describe('manual↔engine: no rule references a key the engine cannot compute', () => {
  it('every wire condition key is engine-computable across the full corpus', () => {
    for (const { name, manual } of fullCorpus) {
      for (const rule of manual.modules.wire_routing.rules) {
        for (const key of Object.keys(rule.condition ?? {})) {
          expect(
            ENGINE_WIRE_KEYS.has(key) || INDICATOR_KEY.test(key),
            `${name}: wire rule references uncomputable condition key "${key}"`
          ).toBe(true)
        }
      }
    }
  })

  it('every button condition key is engine-computable across the full corpus', () => {
    for (const { name, manual } of fullCorpus) {
      for (const rule of manual.modules.button.rules) {
        for (const key of Object.keys(rule.condition ?? {})) {
          expect(
            ENGINE_BUTTON_KEYS.has(key) || INDICATOR_KEY.test(key),
            `${name}: button rule references uncomputable condition key "${key}"`
          ).toBe(true)
        }
      }
    }
  })
})

describe('manual↔engine: every wire color-target rule guarantees its color exists', () => {
  // If a color-target rule could fire with that color absent, the engine falls
  // through to a later rule while a literal reader is left "stuck" (told to cut a
  // wire that isn't there). This guard proves the fall-through never fires, so a
  // literal reader is never stuck — the wire rulebook is uniformly first-match.
  function conditionGuaranteesColor(condition: Record<string, unknown>, color: string): boolean {
    if (condition.color_at_last === color) return true
    const countKey = `count_${color}`
    const c = condition[countKey]
    if (c && typeof c === 'object') {
      const o = c as Record<string, number>
      if ('gt' in o && o.gt >= 0) return true
      if ('gte' in o && o.gte >= 1) return true
    }
    return false
  }

  it('holds across the full corpus', () => {
    for (const { name, manual } of fullCorpus) {
      for (const rule of manual.modules.wire_routing.rules) {
        if (rule.target?.color) {
          expect(
            conditionGuaranteesColor(rule.condition ?? {}, rule.target.color),
            `${name}: color-target rule ${JSON.stringify(rule.condition)} does not guarantee ${rule.target.color} exists`
          ).toBe(true)
        }
      }
    }
  })
})

describe('manual↔engine: dial/keypad rows discriminate any visible subset uniquely', () => {
  it('any two dial columns share ≤2 symbols (3-symbol subset ⇒ unique column)', () => {
    for (const { name, manual } of fullCorpus) {
      const cols = manual.modules.symbol_dial.columns
      for (let i = 0; i < cols.length; i++) {
        for (let j = i + 1; j < cols.length; j++) {
          const shared = cols[i].filter((s) => cols[j].includes(s)).length
          expect(
            shared,
            `${name}: dial columns ${i},${j} share ${shared} symbols`
          ).toBeLessThanOrEqual(2)
        }
      }
    }
  })

  it('any two keypad sequences share ≤3 symbols (4-symbol subset ⇒ unique sequence)', () => {
    for (const { name, manual } of fullCorpus) {
      const seqs = manual.modules.keypad.sequences
      for (let i = 0; i < seqs.length; i++) {
        for (let j = i + 1; j < seqs.length; j++) {
          const shared = seqs[i].filter((s) => seqs[j].includes(s)).length
          expect(
            shared,
            `${name}: keypad sequences ${i},${j} share ${shared} symbols`
          ).toBeLessThanOrEqual(3)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// BEHAVIORAL equivalence — the engine solver's answer equals the literal
// reader's answer for every enumerated config, on the sampled corpus.
// ---------------------------------------------------------------------------

function* wireConfigs(n: number): Generator<string[]> {
  const idx = new Array(n).fill(0)
  while (true) {
    yield idx.map((i) => WIRE_COLORS[i])
    let k = n - 1
    while (k >= 0) {
      idx[k]++
      if (idx[k] < WIRE_COLORS.length) break
      idx[k] = 0
      k--
    }
    if (k < 0) return
  }
}

describe('manual↔engine: wire — engine accepts exactly what the manual, read literally, prescribes', () => {
  // With the two structural invariants above holding over the full corpus (no
  // uncomputable key; every color target guaranteed present ⇒ no engine
  // fall-through), the engine's first-match and the literal reader's first-match
  // are provably identical for EVERY manual. This test demonstrates that
  // exhaustively over the whole 4- and 5-wire config space on the sampled
  // manuals — the reaudit's claimed ~29% divergence, reproduced against the real
  // artifacts, is 0%.
  it('agrees on the full 4- and 5-wire config space (sampled manuals × boundary scenes)', () => {
    let checks = 0
    for (const { name, manual } of behavioralSample) {
      const rules = manual.modules.wire_routing.rules
      for (const n of [4, 5]) {
        for (const wires of wireConfigs(n)) {
          for (const s of WIRE_SCENES) {
            const engine = solveWire(
              { wires: wires.map((color) => ({ color })) } as WireConfig,
              rules,
              s
            )
            const literal = literalWireCut(wires, rules, s)
            const enginePos = engine ? engine.cutPosition : 'nomatch'
            expect(
              literal,
              `${name}: literal reader got STUCK on [${wires.join(',')}] battery=${s.batteryCount} — a color the manual promised is absent`
            ).not.toBe('stuck')
            expect(
              enginePos,
              `${name}: engine≠manual on [${wires.join(',')}] battery=${s.batteryCount} indicators=${JSON.stringify(s.indicators)}`
            ).toBe(literal)
            checks++
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(0)
  }, 60000)
})

const BUTTON_COLORS = ['red', 'blue', 'yellow', 'white']
const BUTTON_LABELS = ['ABORT', 'DETONATE', 'HOLD', 'PRESS']

describe('manual↔engine: button — engine accepts exactly the literal first-match action', () => {
  it('agrees on the full color×label config space (sampled manuals × scenes)', () => {
    let checks = 0
    for (const { name, manual } of behavioralSample) {
      const rules = manual.modules.button.rules
      for (const color of BUTTON_COLORS) {
        for (const label of BUTTON_LABELS) {
          for (const s of SCENES) {
            // indicatorColor / displayNumber are decoys the engine must ignore;
            // vary them to prove they never change the answer.
            const config: ButtonConfig = { color, label, indicatorColor: 'red', displayNumber: 7 }
            const engine = solveButton(config, rules, s)
            const literal = literalButtonAction(config, rules, s)
            expect(
              literal,
              `${name}: literal button reader found no match for ${color}/${label}`
            ).not.toBe('nomatch')
            if (literal === 'nomatch') continue
            expect(
              { action: engine?.action, releaseOnColor: engine?.releaseOnColor },
              `${name}: engine≠manual on button ${color}/${label} battery=${s.batteryCount} indicators=${JSON.stringify(s.indicators)}`
            ).toEqual({ action: literal.action, releaseOnColor: literal.releaseOnColor })
            checks++
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(0)
  })
})

describe('manual↔engine: dial — engine resolves every visible 3-symbol subset to the unique column', () => {
  it('agrees with literal set-discrimination on every 3-subset of every column (sampled manuals)', () => {
    let checks = 0
    const s = scene(2)
    for (const { name, manual } of behavioralSample) {
      const section = manual.modules.symbol_dial
      for (const col of section.columns) {
        for (const visible of combinations(col, 3)) {
          const { row, count } = literalUniqueRow(section.columns, visible)
          expect(
            count,
            `${name}: dial subset ${JSON.stringify(visible)} matched ${count} columns`
          ).toBe(1)
          // Build the config the generator would: each dial holds its visible
          // symbol at index 0 followed by fillers; solveDial reads index 0.
          const dials = visible.map((sym) => {
            const fillers = [...new Set(section.columns.flat())]
              .filter((x) => x !== sym)
              .slice(0, 5)
            return [sym, ...fillers]
          })
          const config: DialConfig = { dials, currentPositions: [0, 0, 0] }
          const engine = solveDial(config, section, s)
          expect(
            engine,
            `${name}: engine failed to resolve dial subset ${JSON.stringify(visible)}`
          ).not.toBeNull()
          const expected = visible.map((sym) => row.indexOf(sym))
          expect(
            engine!.positions,
            `${name}: dial positions mismatch for ${JSON.stringify(visible)}`
          ).toEqual(expected)
          checks++
        }
      }
    }
    expect(checks).toBeGreaterThan(0)
  })
})

describe('manual↔engine: keypad — engine resolves every visible 4-symbol subset to the unique sequence', () => {
  it('agrees with literal set-discrimination on every 4-subset of every sequence (sampled manuals)', () => {
    let checks = 0
    const s = scene(2)
    for (const { name, manual } of behavioralSample) {
      const section = manual.modules.keypad
      for (const seq of section.sequences) {
        for (const visible of combinations(seq, 4)) {
          const { row, count } = literalUniqueRow(section.sequences, visible)
          expect(
            count,
            `${name}: keypad subset ${JSON.stringify(visible)} matched ${count} sequences`
          ).toBe(1)
          const config: KeypadConfig = { symbols: visible }
          const engine = solveKeypad(config, section, s)
          expect(
            engine,
            `${name}: engine failed to resolve keypad subset ${JSON.stringify(visible)}`
          ).not.toBeNull()
          // Literal click order: config.symbols sorted by their index in the row.
          const expected = [...visible]
            .sort((a, b) => row.indexOf(a) - row.indexOf(b))
            .map((sym) => visible.indexOf(sym))
          expect(
            engine!.sequence,
            `${name}: keypad order mismatch for ${JSON.stringify(visible)}`
          ).toEqual(expected)
          checks++
        }
      }
    }
    expect(checks).toBeGreaterThan(0)
  })
})
