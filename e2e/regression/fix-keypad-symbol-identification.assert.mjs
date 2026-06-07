#!/usr/bin/env node
/**
 * Regression assertion runner for the fix-keypad-symbol-identification bundle.
 *
 * Pure data assertions over:
 *   - packages/manual/data/practice.yaml (modules.keypad.rule)
 *
 * Companion scenarios live in
 * e2e/regression/fix-keypad-symbol-identification.gherkin.
 * This script is the executable surface — the gherkin is documentation.
 * Exits 0 on full pass, non-zero on any failure with every failed
 * scenario named in stderr.
 *
 * Bisect contract: on the pre-fix HEAD this script FAILS — the keypad preamble
 * still carries the absolute 「玩家不需要理解"位置"或"序号"」 phrasing and offers
 * NO grid-position fallback, so when the visible 4-symbol set holds a known
 * confusable pair (trident+psi / hourglass+delta) the AI is locked to the
 * symbol-name channel and "先点那个三叉戟" can land on the psi cell → mis-tap →
 * (on daily) a strike toward detonation. After the fix the preamble keeps the
 * symbol name as the DEFAULT channel but adds a quadrant (左上/右上/左下/右下)
 * FALLBACK, so this script PASSES.
 *
 * Usage:
 *   node e2e/regression/fix-keypad-symbol-identification.assert.mjs
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

function loadKeypadRule() {
  const manual = yaml.load(readFileSync(PRACTICE_YAML, 'utf8'))
  return manual?.modules?.keypad?.rule
}

// ---------- Scenario A: grid-position FALLBACK is present ----------
function scenarioA() {
  const name = 'Bug A — keypad rule preamble offers a grid-position fallback for confusable symbols'
  const rule = loadKeypadRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `keypad.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // The four quadrant referents the AI uses to issue position-based taps.
  for (const quadrant of ['左上', '右上', '左下', '右下']) {
    if (!rule.includes(quadrant)) {
      record(name, `rule preamble does not name the grid quadrant "${quadrant}"`)
    }
  }
  // A confusable trigger phrasing — the condition under which to switch.
  if (!/易混|误描述|辨不下|相似/.test(rule)) {
    record(name, 'rule preamble does not name a confusable trigger (易混 / 误描述 / 辨不下 / 相似)')
  }
  // The two known confusable pairs, named via their shared/symbols.ts ids.
  for (const id of ['trident', 'psi', 'hourglass', 'delta']) {
    if (!rule.includes(id)) {
      record(name, `rule preamble does not name the confusable symbol "${id}"`)
    }
  }
}

// ---------- Scenario B: symbol-name default + lookup difficulty intact ----------
function scenarioB() {
  const name =
    'Bug B — keypad rule keeps the symbol-name default channel and the set→sequence lookup'
  const rule = loadKeypadRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `keypad.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // Symbol name stays the DEFAULT channel (position is only the fallback).
  if (!/默认/.test(rule)) {
    record(name, 'rule preamble does not mark the symbol name as the default channel (默认)')
  }
  if (!/符号名/.test(rule)) {
    record(name, 'rule preamble does not name the symbol-name channel (符号名)')
  }
  // Keep the describe-the-shape learning loop.
  if (!/描述/.test(rule) || !/形状|笔画|弧线/.test(rule)) {
    record(name, 'rule preamble drops the shape-description channel (描述 + 形状/笔画/弧线)')
  }
  // The set→unique-sequence lookup difficulty must be UNCHANGED.
  if (!/交集不超过|唯一一条 sequence/.test(rule)) {
    record(
      name,
      'rule preamble drops the set→sequence lookup framing (交集不超过 / 唯一一条 sequence)'
    )
  }
  // Position must be framed as a fallback, NOT the primary referent.
  if (!/兜底/.test(rule)) {
    record(name, 'rule preamble does not frame position as a 兜底 (fallback)')
  }
  if (!/不是默认主指代|不是主指代|才启用|而非主指代/.test(rule)) {
    record(name, 'rule preamble does not state position is fallback-only (不是默认主指代 / 才启用)')
  }
}

// ---------- Scenario C: the stripped "no need to understand position" absolute is gone ----------
function scenarioC() {
  const name = 'Bug C — keypad rule no longer forbids the player understanding position/sequence'
  const rule = loadKeypadRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `keypad.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // The old absolute 「玩家不需要理解"位置"或"序号"」 directly fights the position
  // fallback — it would keep the AI self-bound to symbol names. It must be GONE.
  if (/不需要理解/.test(rule)) {
    record(
      name,
      'rule preamble still carries the stripped absolute "不需要理解位置/序号" (fights the position fallback)'
    )
  }
}

// ---------- Scenario D: position is a player-reported layout fact, not an imagined screen ----------
function scenarioD() {
  const name = 'Bug D — keypad position reads as a player-reported visible layout fact (RED LINE)'
  const rule = loadKeypadRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `keypad.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // The AI-cannot-see-the-screen ask discipline that makes position a thing the
  // AI ASKS for rather than imagines.
  if (!/看不到屏幕|看不见屏幕|你看不到/.test(rule)) {
    record(name, 'rule preamble does not state the AI cannot see the screen (看不到屏幕)')
  }
  // Position is a player-REPORTED, eyes-visible layout fact (the 玩家可报性
  // discriminator) — mirroring wire's legitimate top-to-bottom referent, NOT an
  // AI-imagined screen.
  if (!/亲眼可见|亲口报|报给你/.test(rule)) {
    record(
      name,
      'rule preamble does not frame position as a player-reported visible layout fact (亲眼可见 / 亲口报 / 报给你)'
    )
  }
  // It anchors to the cell/quadrant the player sees, not a code index.
  if (!/格子|象限|哪一格/.test(rule)) {
    record(
      name,
      'rule preamble does not anchor position to the player-visible cell (格子 / 象限 / 哪一格)'
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
  '== fix-keypad-symbol-identification regression run ==\n' +
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
