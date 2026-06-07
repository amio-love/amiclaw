#!/usr/bin/env node
/**
 * Regression assertion runner for the
 * fix-bombsquad-keypad-symbol-glyph-manual-mismatch bundle.
 *
 * Pure data assertions over the symbol SSOT:
 *   - shared/symbols.ts (SYMBOLS — the trident + psi entries' path & description)
 *
 * Companion scenarios live in
 * e2e/regression/fix-bombsquad-keypad-symbol-glyph-manual-mismatch.gherkin.
 * This script is the executable surface — the gherkin is documentation.
 * Exits 0 on full pass, non-zero on any failure with every failed scenario
 * named in stderr.
 *
 * Bisect contract: on the pre-fix HEAD this script FAILS. Pre-fix the trident
 * description claimed a "5 根并排竖刺 / 展开折扇 / 三叉戟" fan whose path was an
 * incoherent central-pole + two downward ∩ Bézier hooks (the path carried `C`
 * curve commands), and neither psi nor trident named the other as an explicit
 * Ψ-family contrast. After the fix — trident redrawn as a straight-line 3-prong
 * trident and both descriptions carrying the mutual U-bowl-vs-prongs anchor —
 * it PASSES.
 *
 * The runner (`pnpm test:regression`) invokes each assert through `tsx`, so the
 * `.ts` SSOT is imported directly — no parsing, the assertion reads exactly
 * what build.ts injects.
 *
 * Usage:
 *   tsx e2e/regression/fix-bombsquad-keypad-symbol-glyph-manual-mismatch.assert.mjs
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

const { SYMBOLS } = await import(resolve(REPO_ROOT, 'shared/symbols.ts'))

const failures = []
function record(scenarioName, message) {
  failures.push(`  ✗ ${scenarioName}\n      ${message}`)
}

function getSymbol(id) {
  return SYMBOLS.find((s) => s.id === id)
}

// ---------- Scenario A: trident description ↔ path fidelity ----------
function scenarioA() {
  const name = 'Bug A — trident description truthfully names a real 3-prong trident'
  const trident = getSymbol('trident')
  if (!trident) {
    record(name, 'symbol id "trident" missing from SYMBOLS')
    return
  }
  const { description: desc, path } = trident

  // (a) The new description must name three separated prongs (三股 / 三叉 / 三齿)
  //     AND a crossbar or central shaft (横梁 / 长柄) — the real-trident
  //     vocabulary that truthfully matches the redrawn path.
  if (!/三股|三叉|三齿/.test(desc)) {
    record(name, 'trident description does not name three separated prongs (三股 / 三叉 / 三齿)')
  }
  if (!/横梁|长柄/.test(desc)) {
    record(name, 'trident description does not name the crossbar / central shaft (横梁 / 长柄)')
  }

  // (b) The pre-fix fiction must be gone: the old description claimed "5 根"
  //     spikes forming an "展开折扇" (opened folding fan). Either token recurring
  //     means the description still describes the dead glyph.
  if (/5\s*根/.test(desc)) {
    record(name, 'trident description still claims the old "5 根" spike count (dead-glyph fiction)')
  }
  if (/折扇/.test(desc)) {
    record(name, 'trident description still claims the old "折扇" (opened-fan) fiction')
  }

  // (c) The path must be straight-line-only — a real trident's prongs + crossbar
  //     + shaft are all straight segments. The pre-fix path drew its two ∩ side
  //     hooks with cubic-Bézier `C` commands; a clean trident path carries NO
  //     curve command (C/S/Q/T/A), only M/L. This is the structural proof the
  //     incoherent hooked glyph is gone.
  if (/[CSQTAcsqta]/.test(path)) {
    record(
      name,
      `trident path still contains a curve command (C/S/Q/T/A) — the ∩-hook glyph is not gone: ${JSON.stringify(
        path
      )}`
    )
  }
}

// ---------- Scenario B: psi/trident mutual disambiguation anchor ----------
function scenarioB() {
  const name = 'Bug B — psi and trident each carry a mutual Ψ-family disambiguation anchor'
  const psi = getSymbol('psi')
  const trident = getSymbol('trident')
  if (!psi) {
    record(name, 'symbol id "psi" missing from SYMBOLS')
    return
  }
  if (!trident) {
    record(name, 'symbol id "trident" missing from SYMBOLS')
    return
  }

  // psi must (a) describe its canonical U-bowl shape and (b) name trident as the
  // explicit contrast so the AI knows which pair this anchor disambiguates.
  if (!/U\s*形碗/.test(psi.description)) {
    record(name, 'psi description does not reference the canonical U 形碗 (U-bowl) shape')
  }
  if (!/trident|三叉戟/.test(psi.description)) {
    record(name, 'psi description does not name trident / 三叉戟 as the explicit contrast')
  }

  // trident must (a) describe its separated straight prongs and (b) name psi as
  // the explicit contrast — the reciprocal anchor.
  if (!/分离/.test(trident.description)) {
    record(name, 'trident description does not stress the prongs are 分离 (separated)')
  }
  if (!/psi/.test(trident.description)) {
    record(name, 'trident description does not name psi as the explicit contrast')
  }
}

// ---------- Driver ----------
const scenarios = [
  ['A', scenarioA],
  ['B', scenarioB],
]

process.stdout.write(
  '== fix-bombsquad-keypad-symbol-glyph-manual-mismatch regression run ==\n' +
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
