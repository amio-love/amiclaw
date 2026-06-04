#!/usr/bin/env node
/**
 * Regression assertion runner for the
 * fix-bombsquad-wire-manual-delivery-role-reversal bundle.
 *
 * Pure data assertions over:
 *   - packages/manual/data/practice.yaml (modules.wire_routing.rule)
 *   - the AI_INSTRUCTIONS injected by packages/manual/build.ts, observed
 *     through the built dist raw YAML (the AI's `?format=yaml` payload)
 *
 * Companion scenarios live in
 * e2e/regression/fix-bombsquad-wire-manual-delivery-role-reversal.gherkin.
 * This script is the executable surface — the gherkin is documentation.
 * Exits 0 on full pass, non-zero on any failure with every failed
 * scenario named in stderr.
 *
 * Bisect contract: on the pre-fix HEAD this script FAILS — the wire
 * preamble carries none of the three hardened elements and AI_INSTRUCTIONS
 * has no `recover_after_failure` key. After the fix it PASSES.
 *
 * Usage:
 *   node e2e/regression/fix-bombsquad-wire-manual-delivery-role-reversal.assert.mjs
 */
import { execFileSync } from 'node:child_process'
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
const DIST_PRACTICE_RAW = resolve(REPO_ROOT, 'packages/manual/dist/data/practice.yaml')

const failures = []
function record(scenarioName, message) {
  failures.push(`  ✗ ${scenarioName}\n      ${message}`)
}

function loadWireRule() {
  const manual = yaml.load(readFileSync(PRACTICE_YAML, 'utf8'))
  return manual?.modules?.wire_routing?.rule
}

/**
 * Build the manual so the dist raw YAML reflects the current AI_INSTRUCTIONS,
 * then load the AI-served payload. Mirrors the AI's `?format=yaml` fetch path.
 */
function loadDistAiInstructions() {
  execFileSync('pnpm', ['--filter', 'manual', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  })
  const payload = yaml.load(readFileSync(DIST_PRACTICE_RAW, 'utf8'))
  return payload?.ai_instructions ?? {}
}

// ---------- Scenario A: strict top-down first-match-wins, no salient jump ----------
function scenarioA() {
  const name = 'Bug A — wire rule preamble emphasises strict top-down first-match-wins'
  const rule = loadWireRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `wire_routing.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // Strict ordered walk anchor — 严格 (strict) paired with a top-down direction.
  if (!/严格/.test(rule)) {
    record(name, 'rule preamble does not emphasise a STRICT walk (no "严格")')
  }
  if (!/自上而下|从上到下|从上往下/.test(rule)) {
    record(name, 'rule preamble does not name the top-down walk direction (自上而下 / 从上到下)')
  }
  // The anti-jump instruction — do NOT jump to the rule that looks most
  // relevant to a salient feature. Negation paired with a "salient / most
  // relevant" object.
  const hasJumpNegation = /不要跳|绝不跳|不可跳|别跳/.test(rule)
  if (!hasJumpNegation) {
    record(
      name,
      'rule preamble does not forbid jumping ahead (expected "不要跳" / "绝不跳" / "别跳")'
    )
  }
  const hasSalientObject = /显眼|最相关|最像|最突出/.test(rule)
  if (!hasSalientObject) {
    record(
      name,
      'rule preamble does not name the salient-feature trap object (显眼 / 最相关 / 最像 / 最突出)'
    )
  }
}

// ---------- Scenario B: worked color-filter SKIP example ----------
function scenarioB() {
  const name = 'Bug B — wire rule preamble works the color-filter SKIP example (all-yellow)'
  const rule = loadWireRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `wire_routing.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // The example must concretely reference both the yellow trigger and the
  // absent red action color — the condition-color ≠ action-color case.
  if (!/黄/.test(rule)) {
    record(
      name,
      'rule preamble color-filter example does not reference 黄 (the all-yellow trigger)'
    )
  }
  if (!/红/.test(rule)) {
    record(
      name,
      'rule preamble color-filter example does not reference 红 (the absent action color)'
    )
  }
  // The "rule does not apply, continue" skip semantics.
  if (!/不适用/.test(rule)) {
    record(name, 'rule preamble does not state the rule "不适用" when the action color is absent')
  }
  if (!/继续/.test(rule)) {
    record(name, 'rule preamble does not tell the AI to 继续 (continue to the next rule) on a skip')
  }
  // The explicit anti-repair: never "fix" the action to an available color.
  const hasAntiRepair = /绝不改成剪黄|不要改成剪黄|绝不改剪黄|不能改成剪黄/.test(rule)
  if (!hasAntiRepair) {
    record(
      name,
      'rule preamble does not forbid "repairing" the action to the available color (绝不改成剪黄)'
    )
  }
}

// ---------- Scenario C: scene-info ask-gate ----------
function scenarioC() {
  const name = 'Bug C — wire rule preamble carries a scene-info ask-gate'
  const rule = loadWireRule()
  if (typeof rule !== 'string' || rule.length === 0) {
    record(name, `wire_routing.rule is missing or empty (got: ${JSON.stringify(rule)})`)
    return
  }
  // The gate names the scene-info the rules depend on.
  if (!/电池/.test(rule)) {
    record(name, 'rule preamble scene-info gate does not name 电池 (battery count)')
  }
  if (!/指示灯/.test(rule)) {
    record(name, 'rule preamble scene-info gate does not name 指示灯 (indicator)')
  }
  // The gate tells the AI to ASK the player before answering.
  const hasAsk = /问玩家|先问|向玩家确认|让玩家报|问一下玩家/.test(rule)
  if (!hasAsk) {
    record(
      name,
      'rule preamble does not instruct the AI to ASK the player for missing scene info (问玩家 / 先问)'
    )
  }
  // The gate forbids guessing scene-info-dependent rules.
  const hasNoGuess = /不要猜|绝不靠猜|不能猜|别靠猜|不靠猜/.test(rule)
  if (!hasNoGuess) {
    record(
      name,
      'rule preamble does not forbid guessing a scene-info-dependent answer (不要猜 / 绝不靠猜)'
    )
  }
}

// ---------- Scenario D: recover_after_failure AI instruction ----------
function scenarioD() {
  const name = 'Bug D — AI_INSTRUCTIONS carries a recover_after_failure failsafe'
  let instructions
  try {
    instructions = loadDistAiInstructions()
  } catch (err) {
    record(name, `could not build / load dist AI_INSTRUCTIONS: ${err?.message ?? err}`)
    return
  }
  const recover = instructions.recover_after_failure
  if (!Array.isArray(recover) || recover.length === 0) {
    record(
      name,
      `ai_instructions.recover_after_failure is missing or empty (got: ${JSON.stringify(recover)})`
    )
    return
  }
  const text = recover.join('\n')
  // Anti-role-reversal: after a failure NEVER ask the player for the rules /
  // manual / right answer.
  const hasNoReverseAsk = /绝不反问|不要反问|不要向玩家要|绝不向玩家要/.test(text)
  if (!hasNoReverseAsk) {
    record(name, 'recover_after_failure does not forbid reverse-asking the player (绝不反问)')
  }
  // The corrective discipline: re-walk the rules yourself.
  if (!/重新走|重新过|自己重走|重走/.test(text)) {
    record(name, 'recover_after_failure does not tell the AI to re-walk the rules itself (重新走)')
  }
  // Stay in role.
  if (!/角色/.test(text)) {
    record(name, 'recover_after_failure does not tell the AI to stay in role (角色)')
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
  '== fix-bombsquad-wire-manual-delivery-role-reversal regression run ==\n' +
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
