#!/usr/bin/env node
/**
 * Regression assertion runner for the
 * fix-bombsquad-dial-ai-asks-player-for-manual bundle.
 *
 * Pure data assertions over:
 *   - packages/manual/data/practice.yaml (modules.symbol_dial.rule)
 *
 * Companion scenarios live in
 * e2e/regression/fix-bombsquad-dial-ai-asks-player-for-manual.gherkin.
 * This script is the executable surface — the gherkin is documentation.
 * Exits 0 on full pass, non-zero on any failure with every failed
 * scenario named in stderr.
 *
 * Usage:
 *   node e2e/regression/fix-bombsquad-dial-ai-asks-player-for-manual.assert.mjs
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

const failures = []
function record(scenarioName, message) {
  failures.push(`  ✗ ${scenarioName}\n      ${message}`)
}

function loadDialRule() {
  const manual = yaml.load(readFileSync(PRACTICE_YAML, 'utf8'))
  return manual?.modules?.symbol_dial?.rule
}

// ---------- Scenario A: ask-the-player, never paint the screen ----------
// SUPERSEDED 2026-06-04 (task fix-bombsquad-dial-ai-invents-pointer-direction):
// PR#106 added a visual anchor (摆轮 + 屏幕/看到) on the theory that letting
// the AI "describe what the player sees" would steady the conversation. The
// dial bug recurred anyway — describing the visual surface lured the AI into
// REASONING about a scene it cannot see, inventing a pointer / "turn every
// dial to 12 o'clock" mechanic the manual never defined. That route is now
// empirically falsified. The new core principle: the preamble carries only
// the lookup rule + the one input it needs from the player + the discipline
// "you cannot see the screen, so ASK; never fabricate visual attributes".
// This scenario now asserts THAT — the inverse of the original anchor.
// The fully fleshed-out de-visualisation guard lives in the sibling bundle
// fix-bombsquad-dial-ai-invents-pointer-direction.assert.mjs; this kept-stub
// pins the supersession so a future edit cannot silently re-add 摆轮/顺时针.
function scenarioA() {
  const name = 'Bug A — dial rule preamble asks the player, never paints the screen'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // The de-visualisation guard: no on-screen display-form description and no
  // clock-face direction — both seed the invented pointer / 12-o'clock mechanic.
  if (/摆轮/.test(rule)) {
    record(
      name,
      'rule preamble still mentions "摆轮" (an on-screen display-form description; the visual-anchor route was falsified — see supersession note)'
    )
  }
  if (/顺时针/.test(rule)) {
    record(
      name,
      'rule preamble still mentions "顺时针" (a clock-face direction the AI cannot observe)'
    )
  }
  // The ask-the-player framing that replaces the visual anchor: the AI cannot
  // see the screen, so it must ask the player for the current symbol.
  if (!/看不到屏幕|看不见屏幕|你看不到|看不到画面/.test(rule)) {
    record(
      name,
      'rule preamble does not state the AI cannot see the screen (看不到屏幕 / 看不见屏幕 / 你看不到) — the ask-the-player framing that replaces the visual anchor'
    )
  }
}

// ---------- Scenario B: spoken-translation step ----------
function scenarioB() {
  const name = 'Bug B — dial rule preamble teaches the spoken-translation step'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // Player-facing verb phrase.
  if (!/按右箭头/.test(rule)) {
    record(
      name,
      'rule preamble does not mention "按右箭头" (the player-facing verb phrase the AI should speak)'
    )
  }
  // Count phrasing — accept N 次, 几次, or any single-digit-then-次. The
  // existing pre-fix preamble said "按右箭头到达该 index" without any
  // count phrasing, so this is the discriminating assertion.
  if (!/N\s*次|几次|\d+\s*次/.test(rule)) {
    record(
      name,
      'rule preamble does not pair "按右箭头" with a count phrasing ("N 次" / "几次" / a numeric 次)'
    )
  }
}

// ---------- Scenario C: per-dial filler pool disclosure ----------
function scenarioC() {
  const name = 'Bug C — dial rule preamble discloses the per-dial filler pool'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // Disclosure of the per-dial 6-symbol pool model. The NEW preamble must
  // pair BOTH "filler" (English term) AND "5 个" (the explicit count of
  // filler symbols per dial) — the pre-fix rule already contained "6 符号池"
  // alone, so requiring both phrasings together makes this scenario
  // properly discriminate fixed-vs-unfixed.
  if (!/filler/.test(rule)) {
    record(
      name,
      'rule preamble does not mention "filler" (English term for the per-dial filler symbols)'
    )
  }
  if (!/5\s*个/.test(rule)) {
    record(
      name,
      'rule preamble does not mention "5 个" (the explicit count of filler symbols per dial)'
    )
  }
}

// ---------- Scenario D: target-arrangement disclaimer ----------
function scenarioD() {
  const name = 'Bug D — dial rule preamble disclaims AI predicting the post-rotation symbol'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // Negation keyword. Widened dictionary so future stylistic edits cannot
  // silently weaken the disclaimer.
  const hasNegation = /不能|不需要告诉|不预言|无法|不应|不可/.test(rule)
  if (!hasNegation) {
    record(
      name,
      'rule preamble does not carry a negation keyword (expected "不能" / "不需要告诉" / "不预言" / "无法" / "不应" / "不可")'
    )
  }
  // Target / final / "see what" pairing.
  const hasTargetPhrase = /目标|最终|看到什么/.test(rule)
  if (!hasTargetPhrase) {
    record(
      name,
      'rule preamble does not mention "目标" / "最终" / "看到什么" (the disclaimer needs an object)'
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
  '== fix-bombsquad-dial-ai-asks-player-for-manual regression run ==\n' +
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
