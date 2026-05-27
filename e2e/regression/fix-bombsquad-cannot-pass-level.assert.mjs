#!/usr/bin/env node
/**
 * Regression assertion runner for the fix-bombsquad-cannot-pass-level bundle.
 *
 * Pure data assertions over:
 *   - packages/manual/data/practice.yaml (wire_routing.rule, button.rule)
 *   - packages/game/src/modules/keypad/KeypadModule.module.css (.symbol stroke)
 *   - shared/symbols.ts (trident description)
 *
 * Companion scenarios live in
 * e2e/regression/fix-bombsquad-cannot-pass-level.gherkin. This script is the
 * executable surface — the gherkin is documentation. Exits 0 on full pass,
 * non-zero on any failure with every failed scenario named in stderr.
 *
 * Usage:
 *   node e2e/regression/fix-bombsquad-cannot-pass-level.assert.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
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
const KEYPAD_CSS = resolve(REPO_ROOT, 'packages/game/src/modules/keypad/KeypadModule.module.css')
const SYMBOLS_TS = resolve(REPO_ROOT, 'shared/symbols.ts')

const failures = []
function record(scenarioName, message) {
  failures.push(`  ✗ ${scenarioName}\n      ${message}`)
}

function loadPractice() {
  return yaml.load(readFileSync(PRACTICE_YAML, 'utf8'))
}

// ---------- Scenario A: wire_routing rule preamble ----------
function scenarioA() {
  const name = 'Bug A — wire_routing manual declares 0-indexed position + first-match-wins'
  const manual = loadPractice()
  const rule = manual?.modules?.wire_routing?.rule
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `wire_routing.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // 0-indexed declaration in Chinese — accept either the phrase 0-indexed
  // or an explicit "0 = 最上" style statement.
  if (!/0[\s-]*indexed/i.test(rule) && !/0\s*=\s*最/.test(rule)) {
    record(
      name,
      'rule preamble does not declare 0-indexed semantics (expected "0-indexed" or "0 = 最…" phrasing in Chinese)'
    )
  }
  // first-match-wins declaration.
  if (!/first[\s-]*match[\s-]*wins/i.test(rule)) {
    record(name, 'rule preamble does not declare "first-match-wins"')
  }
  // first ≡ 0 and last ≡ length-1 equivalence — accept either Chinese 等价 phrasing
  // or the literal ≡ glyph.
  const declaresFirst =
    /first\s*[≡=]\s*(?:position\s*)?0/i.test(rule) ||
    /关键字\s*first[^。]*?(?:等价|≡|=)[^。]*?0/i.test(rule)
  const declaresLast =
    /last\s*[≡=]\s*(?:position\s*)?length\s*[-－]\s*1/i.test(rule) ||
    /关键字\s*last[^。]*?(?:等价|≡|=)[^。]*?length\s*[-－]\s*1/i.test(rule)
  if (!declaresFirst) {
    record(name, 'rule preamble does not declare "first ≡ 0" equivalence')
  }
  if (!declaresLast) {
    record(name, 'rule preamble does not declare "last ≡ length-1" equivalence')
  }
}

// ---------- Scenario B: button rule preamble ----------
function scenarioB() {
  const name = 'Bug B — button manual declares rule preamble'
  const manual = loadPractice()
  const rule = manual?.modules?.button?.rule
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `button.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  if (!/first[\s-]*match[\s-]*wins/i.test(rule)) {
    record(name, 'rule preamble does not declare "first-match-wins"')
  }
  // The action shapes are tap vs hold-and-release-on-light. Require both
  // Chinese keywords appear ("短按" or "tap" for tap, "按住" or "hold" for hold).
  if (!/短按|tap/i.test(rule)) {
    record(name, 'rule preamble does not explain the tap action')
  }
  if (!/按住|hold/i.test(rule)) {
    record(name, 'rule preamble does not explain the hold action')
  }
}

// ---------- Scenario C: keypad un-tapped symbol stroke contrast ----------
function scenarioC() {
  const name = 'Bug C — keypad un-tapped symbol stroke has sufficient contrast'
  const css = readFileSync(KEYPAD_CSS, 'utf8')
  // Find the `.symbol { ... }` rule (the one that styles un-tapped state —
  // NOT `.star.tapped .symbol`, which is a nested override).
  const symbolRuleMatch = css.match(/\n\.symbol\s*\{([\s\S]*?)\}/)
  if (!symbolRuleMatch) {
    record(name, '.symbol selector rule not found in KeypadModule.module.css')
    return
  }
  const body = symbolRuleMatch[1]
  const strokeMatch = body.match(/stroke\s*:\s*([^;]+);/i)
  if (!strokeMatch) {
    record(name, '.symbol rule has no stroke declaration')
    return
  }
  const strokeValue = strokeMatch[1].trim()
  // Pre-fix offending value: rgba(255, 255, 255, 0.5)
  if (/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.5\s*\)/.test(strokeValue)) {
    record(name, `.symbol stroke is still the dim pre-Atlas-after value: ${strokeValue}`)
    return
  }
  // Accept either var(--color-text-primary), var(--y), or any other
  // non-50%-transparent value. The negative check above is the load-bearing one.
  if (!/var\(--color-text-primary\)|var\(--y\)|var\(--y-glow-\d+\)|#|rgb/i.test(strokeValue)) {
    record(
      name,
      `.symbol stroke uses an unrecognized value (expected var(--color-text-primary) / var(--y) / explicit color): ${strokeValue}`
    )
  }
}

// ---------- Scenario D: trident description matches SVG ----------
function scenarioD() {
  const name = 'Bug D — trident description matches SVG'
  const symbolsSrc = readFileSync(SYMBOLS_TS, 'utf8')
  // Locate the trident entry by id, then extract its description string.
  // Symbols are object literals — naive but adequate regex.
  const tridentBlockMatch = symbolsSrc.match(/\{\s*id:\s*['"]trident['"][\s\S]*?\}/)
  if (!tridentBlockMatch) {
    record(name, 'trident entry not found in shared/symbols.ts')
    return
  }
  const block = tridentBlockMatch[0]
  const descMatch = block.match(/description:\s*([\s\S]*?,\s*\n\s*path:)/)
  if (!descMatch) {
    record(name, 'trident.description field not found')
    return
  }
  const descRaw = descMatch[1]
  // The mis-statement we are guarding against: arcs claimed to connect
  // 左-中 AND 中-右 inner spikes. The actual SVG sweeps outward.
  const claimsLeftMiddle = /左[-－]中/.test(descRaw)
  const claimsMiddleRight = /中[-－]右/.test(descRaw)
  if (claimsLeftMiddle && claimsMiddleRight) {
    record(
      name,
      'trident description still claims arcs connect 左-中 AND 中-右 inner spikes (the historical mis-statement)'
    )
  }
  // Positive check: the description must mention outward-wing semantics.
  if (!/(外侧|外翼|向外)/.test(descRaw)) {
    record(
      name,
      'trident description does not mention outer / outward semantics (expected 外侧 / 外翼 / 向外)'
    )
  }
}

// ---------- Driver ----------
const scenarios = [
  ['A', scenarioA],
  ['B', scenarioB],
  ['C', scenarioC],
  ['D', scenarioD],
]

process.stdout.write(
  '== fix-bombsquad-cannot-pass-level regression run ==\n' +
    `Repo root: ${REPO_ROOT}\n` +
    `Scenarios: ${scenarios.length}\n\n`
)

for (const [, fn] of scenarios) {
  fn()
}

if (failures.length === 0) {
  process.stdout.write('✓ all 4 scenarios passed\n')
  process.exit(0)
}

process.stderr.write(`✗ ${failures.length} failure(s):\n`)
for (const f of failures) {
  process.stderr.write(`${f}\n`)
}
process.exit(1)
