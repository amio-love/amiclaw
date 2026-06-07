#!/usr/bin/env node
/**
 * Regression assertion runner for the fix-manual-color-filter-controlflow task.
 *
 * Pure data assertions over:
 *   - packages/manual/data/practice.yaml (modules.wire_routing.rules + .rule)
 *   - every packages/manual/data/daily/*.yaml (rules carried by the
 *     deterministic generator, preamble carried verbatim)
 *
 * Companion scenarios live in
 * e2e/regression/fix-manual-color-filter-controlflow.gherkin. This script is
 * the executable surface — the gherkin is documentation. Exits 0 on full pass,
 * non-zero on any failure with every failed scenario named in stderr.
 *
 * What it guards (the structural-supersede state):
 *   Scenario A — control-flow invariant: every wire rule whose target carries a
 *     `color` must have a condition that GUARANTEES at least one wire of that
 *     color exists on the board. Without that guarantee the rule can match its
 *     condition yet fail to resolve its color-filtered target — the manual's
 *     sole "match-then-fall-through" control flow that a weaker AI partner
 *     mis-handles. This holds over practice.yaml AND every daily file.
 *   Scenario B — dead-clause removal: the wire preamble no longer instructs the
 *     AI to "skip to the next rule when the action color is absent" (the now
 *     impossible fall-through), while still forbidding arbitrary color
 *     substitution (绝不擅自换色 / 绝不改色).
 *
 * Bisect contract: on the pre-fix practice.yaml this script FAILS — the
 * `{wire_count:4, color_at_last:yellow} → {position:last, color:red}` rule
 * keys on yellow but cuts red with no guarantee a red wire exists, and the
 * preamble still carries the skip clause. After the fix (condition gains
 * `count_red: {gt: 0}` and the preamble drops the skip clause) it PASSES.
 *
 * Usage:
 *   node e2e/regression/fix-manual-color-filter-controlflow.assert.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

const require = createRequire(import.meta.url)
const yaml = require(
  require.resolve('js-yaml', {
    paths: [resolve(REPO_ROOT, 'packages/manual')],
  })
)

const PRACTICE_YAML = resolve(REPO_ROOT, 'packages/manual/data/practice.yaml')
const DAILY_DIR = resolve(REPO_ROOT, 'packages/manual/data/daily')

const failures = []
function record(scenarioName, message) {
  failures.push(`  ✗ ${scenarioName}\n      ${message}`)
}

function loadManual(path) {
  return yaml.load(readFileSync(path, 'utf8'))
}

function manualPaths() {
  const paths = [['practice.yaml', PRACTICE_YAML]]
  for (const file of readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml'))) {
    paths.push([file, join(DAILY_DIR, file)])
  }
  return paths
}

/**
 * Does this rule condition GUARANTEE at least one wire of `color` exists?
 *
 * Two condition shapes carry that guarantee:
 *   - color_at_last: <color>        → the last wire IS that color ⇒ ≥1 exists
 *   - count_<color>: { gt: N }      → strictly more than N (N>=0) ⇒ ≥1 exists
 *   - count_<color>: { gte: N }     → at least N (N>=1) ⇒ ≥1 exists
 *   - count_<color>: <positive int> → an exact positive count ⇒ ≥1 exists
 *
 * Anything else (a count on a DIFFERENT color, a battery/indicator key, a
 * color_at_last of a DIFFERENT color, etc.) does NOT guarantee the target
 * color exists.
 */
function conditionGuaranteesColor(condition, color) {
  if (!condition || typeof condition !== 'object') return false

  if (condition.color_at_last === color) return true

  const countKey = `count_${color}`
  if (countKey in condition) {
    const v = condition[countKey]
    if (typeof v === 'number') return v >= 1
    if (v && typeof v === 'object') {
      if ('gt' in v && typeof v.gt === 'number') return v.gt >= 0
      if ('gte' in v && typeof v.gte === 'number') return v.gte >= 1
    }
  }
  return false
}

// ---------- Scenario A: color-target control-flow invariant ----------
function scenarioA() {
  const name =
    'A — every color-targeted wire rule has a condition guaranteeing that color exists (no match-then-fall-through)'
  for (const [label, path] of manualPaths()) {
    let manual
    try {
      manual = loadManual(path)
    } catch (err) {
      record(name, `${label}: could not parse YAML: ${err?.message ?? err}`)
      continue
    }
    const rules = manual?.modules?.wire_routing?.rules
    if (!Array.isArray(rules)) {
      record(name, `${label}: modules.wire_routing.rules is not an array`)
      continue
    }
    rules.forEach((rule, i) => {
      const color = rule?.target?.color
      if (color === undefined) return // position-only target — always resolvable
      if (!conditionGuaranteesColor(rule.condition, color)) {
        record(
          name,
          `${label}: rule #${i} targets color '${color}' but its condition ` +
            `${JSON.stringify(rule.condition)} does not guarantee a '${color}' wire exists ` +
            `→ this rule can match yet fail to resolve its target (the forbidden control flow)`
        )
      }
    })
  }
}

// ---------- Scenario B: dead skip-clause removed, anti-substitution kept ----------
function scenarioB() {
  const name =
    'B — wire preamble dropped the now-impossible "skip on color absence" clause but still forbids arbitrary color substitution'
  for (const [label, path] of manualPaths()) {
    let manual
    try {
      manual = loadManual(path)
    } catch (err) {
      record(name, `${label}: could not parse YAML: ${err?.message ?? err}`)
      continue
    }
    const rule = manual?.modules?.wire_routing?.rule
    if (typeof rule !== 'string' || rule.length === 0) {
      record(name, `${label}: wire_routing.rule is missing or empty`)
      continue
    }
    // The dead clause: the old hardening told the AI that a color-filter rule
    // could be 不适用 and to 继续 to the next rule on color absence. The
    // structural fix makes that fall-through impossible, so the preamble must
    // no longer instruct skipping a color-filter rule because its action color
    // is absent. The tell-tale dead phrasing was "绝不改成剪黄" — the worked
    // all-yellow skip example. Its presence means the skip clause survived.
    if (/绝不改成剪黄|改成剪黄/.test(rule)) {
      record(
        name,
        `${label}: preamble still carries the dead all-yellow skip example (改成剪黄) — ` +
          `the structural fix makes that fall-through impossible; remove it`
      )
    }
    // The retained discipline: never arbitrarily swap the cut color.
    if (!/绝不擅自换色|绝不擅自把要剪的颜色换成|不得擅自换色/.test(rule)) {
      record(
        name,
        `${label}: preamble no longer forbids arbitrary color substitution ` +
          `(expected 绝不擅自换色 / 绝不擅自把要剪的颜色换成…)`
      )
    }
    // The reframed color-filter explanation must assert the structural
    // guarantee: a color-targeted rule's condition already ensures that color
    // is present, so the target is always resolvable.
    if (!/condition 已保证|condition 必保证|已保证该色存在|保证该色至少/.test(rule)) {
      record(
        name,
        `${label}: preamble does not reframe color-filter as a structural guarantee ` +
          `(expected "带 color 的规则其 condition 已保证该色存在")`
      )
    }
  }
}

// ---------- Driver ----------
const scenarios = [
  ['A', scenarioA],
  ['B', scenarioB],
]

process.stdout.write(
  '== fix-manual-color-filter-controlflow regression run ==\n' +
    `Repo root: ${REPO_ROOT}\n` +
    `Scenarios: ${scenarios.length}\n\n`
)

for (const [, fn] of scenarios) {
  fn()
}

if (failures.length === 0) {
  process.stdout.write('✓ all 2 scenarios passed\n')
  process.exit(0)
}

process.stderr.write(`✗ ${failures.length} failure(s):\n`)
for (const f of failures) {
  process.stderr.write(`${f}\n`)
}
process.exit(1)
