#!/usr/bin/env node
/**
 * Regression assertion runner for the
 * fix-bombsquad-dial-ai-invents-pointer-direction bundle.
 *
 * Pure data assertions over:
 *   - packages/manual/data/practice.yaml (modules.symbol_dial.rule)
 *
 * Companion scenarios live in
 * e2e/regression/fix-bombsquad-dial-ai-invents-pointer-direction.gherkin.
 * This script is the executable surface — the gherkin is documentation.
 * Exits 0 on full pass, non-zero on any failure with every failed
 * scenario named in stderr.
 *
 * Bisect contract: on the pre-fix HEAD this script FAILS — the dial preamble
 * still describes the on-screen visual scene (摆轮 / 顺时针走 1 格), which is
 * exactly what lured the AI into inventing an undefined pointer / "12 o'clock"
 * mechanic and reverse-asking the player for a pointer direction the manual
 * never defined. After the fix it PASSES.
 *
 * Usage:
 *   node e2e/regression/fix-bombsquad-dial-ai-invents-pointer-direction.assert.mjs
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

// ---------- Scenario A: no on-screen visual scene painting ----------
function scenarioA() {
  const name = 'Bug A — dial rule preamble does not paint the on-screen visual scene'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // 摆轮 — an on-screen display-form description. Describing the visual
  // surface is what invited the AI to reason about (and invent) a scene it
  // cannot see, so the new principle forbids it in the preamble.
  if (/摆轮/.test(rule)) {
    record(
      name,
      'rule preamble still mentions "摆轮" (an on-screen display-form description that invites visual invention)'
    )
  }
  // 顺时针 — a clock-face direction the AI cannot observe; it seeds the
  // invented "turn the pointer to 12 o'clock" mechanic.
  if (/顺时针/.test(rule)) {
    record(
      name,
      'rule preamble still mentions "顺时针" (a clock-face direction the AI cannot observe)'
    )
  }
}

// ---------- Scenario B: ask-the-player-for-the-current-symbol framing ----------
function scenarioB() {
  const name = 'Bug B — dial rule preamble frames the ask-the-player-for-the-current-symbol step'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // "You cannot see the screen" — the discipline that makes the AI ASK
  // rather than fabricate.
  const hasCannotSee = /看不到屏幕|看不见屏幕|你看不到|看不到画面/.test(rule)
  if (!hasCannotSee) {
    record(
      name,
      'rule preamble does not state the AI cannot see the screen (看不到屏幕 / 看不见屏幕 / 你看不到)'
    )
  }
  // Ask the player to report / describe the current symbol — 报 or 描述
  // paired with 符号.
  const hasAskForSymbol = /(报|描述|念).*符号|符号.*(报|描述|念)/.test(rule)
  if (!hasAskForSymbol) {
    record(
      name,
      'rule preamble does not tell the AI to ask the player to report the current 符号 (报 / 描述 paired with 符号)'
    )
  }
}

// ---------- Scenario C: press-right-N-times count action survives ----------
function scenarioC() {
  const name = 'Bug C — dial rule preamble keeps the press-right-N-times count action'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // Player-facing verb phrase — a concrete action instruction, not a visual
  // description, so it survives the de-visualisation rewrite.
  if (!/按右箭头/.test(rule)) {
    record(
      name,
      'rule preamble does not mention "按右箭头" (the player-facing verb phrase the AI should speak)'
    )
  }
  // Count phrasing — accept N 次, 几次, or any single-digit-then-次.
  if (!/N\s*次|几次|\d+\s*次/.test(rule)) {
    record(
      name,
      'rule preamble does not pair "按右箭头" with a count phrasing ("N 次" / "几次" / a numeric 次)'
    )
  }
}

// ---------- Scenario D: no-fabricated-target disclaimer survives ----------
function scenarioD() {
  const name = 'Bug D — dial rule preamble forbids inventing the post-rotation symbol or target'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // Negation keyword.
  const hasNegation = /不能|不需要|不预言|无法|不应|不可/.test(rule)
  if (!hasNegation) {
    record(
      name,
      'rule preamble does not carry a negation keyword (expected "不能" / "不需要" / "不预言" / "无法" / "不可")'
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
  '== fix-bombsquad-dial-ai-invents-pointer-direction regression run ==\n' +
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
