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

// ---------- Scenario A: visual anchor ----------
function scenarioA() {
  const name = 'Bug A — dial rule preamble carries a visual anchor'
  const rule = loadDialRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `symbol_dial.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // "what the player sees" anchor — 屏幕 / 看到 (visual surface).
  if (!/屏幕|看到/.test(rule)) {
    record(
      name,
      'rule preamble does not mention "屏幕" or "看到" (no visual surface anchor for what the player sees)'
    )
  }
  // The dial display form — 摆轮 (the on-screen artefact).
  if (!/摆轮/.test(rule)) {
    record(
      name,
      'rule preamble does not mention "摆轮" (the dial display form the player physically sees)'
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
  // Disclosure of the per-dial 6-symbol pool model. Accept any of:
  //   - "filler" (English term used inline)
  //   - "5 个" (the count of filler symbols per dial)
  //   - "6 符号池" (the existing phrasing — still permitted)
  if (!/filler|5\s*个|6\s*符号池/.test(rule)) {
    record(
      name,
      'rule preamble does not disclose the per-dial 6-symbol pool model (expected "filler" / "5 个" / "6 符号池")'
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
  // Negation keyword.
  const hasNegation = /不能|不需要告诉|不预言/.test(rule)
  if (!hasNegation) {
    record(
      name,
      'rule preamble does not carry a negation keyword (expected "不能" / "不需要告诉" / "不预言")'
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
