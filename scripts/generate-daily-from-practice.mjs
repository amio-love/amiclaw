#!/usr/bin/env node
/**
 * Generate daily manual YAML files by seed-permuting `packages/manual/data/practice.yaml`.
 *
 * Usage:
 *   node scripts/generate-daily-from-practice.mjs --from YYYY-MM-DD --days N
 *
 * For each date in the range, produces a deterministic permutation of the
 * practice rulebook:
 *   - `wire_routing.rules` and `button.rules` are reordered while preserving
 *     the precedence invariants required by the rule engine (general
 *     fallthrough rules stay after their more-specific siblings; the absolute
 *     `condition: {}` catch-all stays last).
 *   - `symbol_dial.columns` and `keypad.sequences` are shuffled, and each
 *     column / sequence's 6-symbol order is permuted.
 *   - `decoy_modules` is carried over verbatim (opaque to the game engine).
 *   - `meta` is rewritten to `{ version: <date>, type: daily }`.
 *
 * Idempotent:
 *   - Same date → same seed → byte-equal YAML output.
 *   - If `data/daily/<date>.yaml` already exists with matching content, skip.
 *   - If it exists but content differs, abort with a clear error (never
 *     silently overwrite a committed file).
 *
 * Pure ESM, no new deps — uses `js-yaml` already present in
 * `packages/manual`.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Resolve js-yaml from the manual package where it is declared.
const yaml = require(
  require.resolve('js-yaml', {
    paths: [resolve(fileURLToPath(import.meta.url), '../../packages/manual')],
  })
)

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const PRACTICE_YAML = resolve(REPO_ROOT, 'packages/manual/data/practice.yaml')
const DAILY_DIR = resolve(REPO_ROOT, 'packages/manual/data/daily')

// ---------- CLI parsing ----------
function parseArgs(argv) {
  const args = { from: null, days: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from') args.from = argv[++i]
    else if (a === '--days') args.days = Number(argv[++i])
    else if (a.startsWith('--from=')) args.from = a.slice('--from='.length)
    else if (a.startsWith('--days=')) args.days = Number(a.slice('--days='.length))
  }
  return args
}

function usage(exitCode = 1) {
  process.stderr.write(
    'Usage: node scripts/generate-daily-from-practice.mjs --from YYYY-MM-DD --days N\n'
  )
  process.exit(exitCode)
}

// ---------- Deterministic RNG ----------
/**
 * 32-bit FNV-1a hash of a string. Used as the seed for the per-date RNG.
 */
export function fnv1a32(input) {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Force unsigned 32-bit
  return h >>> 0
}

/**
 * mulberry32 — small, fast, well-distributed 32-bit PRNG.
 * Same seed → same sequence on every platform.
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher-Yates shuffle on a fresh copy of `arr`, driven by `rng`.
 */
export function seededShuffle(arr, rng) {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ---------- Date helpers ----------
function isValidDateString(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  // Round-trip check to catch e.g. 2026-02-30
  return d.toISOString().slice(0, 10) === s
}

function* iterateDates(fromDateString, days) {
  const start = new Date(`${fromDateString}T00:00:00Z`)
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000)
    yield d.toISOString().slice(0, 10)
  }
}

// ---------- Rule-precedence-preserving permutation ----------
/**
 * A wire rule's condition can have:
 *   - no `wire_count` AND no other keys → absolute `{}` catch-all (must stay last)
 *   - `wire_count: N` only → "general" fallthrough for that wire count
 *   - `wire_count: N` plus other keys → "specific" rule for that wire count
 *
 * To preserve solvability we:
 *   1. Group rules by `wire_count` (4, 5, ...) plus a "catchall" bucket.
 *   2. Within each wire_count group, shuffle the specific rules; keep the
 *      general rule (if any) at the tail of its group.
 *   3. Concatenate groups in ascending wire_count order, then append the
 *      catchall bucket (always last).
 */
function isCatchAllCondition(cond) {
  return cond && typeof cond === 'object' && Object.keys(cond).length === 0
}

function permuteWireRules(rules, rng) {
  const byWireCount = new Map() // wire_count → { specific: [], general: rule | null }
  const catchAll = []

  for (const rule of rules) {
    const cond = rule.condition ?? {}
    if (isCatchAllCondition(cond)) {
      catchAll.push(rule)
      continue
    }
    const wireCount = cond.wire_count
    if (wireCount === undefined) {
      // No wire_count key but non-empty condition: treat as catch-all-adjacent
      // (defensive — practice.yaml does not currently produce this shape).
      catchAll.push(rule)
      continue
    }
    if (!byWireCount.has(wireCount)) {
      byWireCount.set(wireCount, { specific: [], general: null })
    }
    const bucket = byWireCount.get(wireCount)
    const otherKeyCount = Object.keys(cond).filter((k) => k !== 'wire_count').length
    if (otherKeyCount === 0) {
      // condition has only wire_count → general fallthrough for that wire count
      bucket.general = rule
    } else {
      bucket.specific.push(rule)
    }
  }

  const sortedWireCounts = [...byWireCount.keys()].sort((a, b) => a - b)
  const out = []
  for (const wc of sortedWireCounts) {
    const { specific, general } = byWireCount.get(wc)
    const shuffled = seededShuffle(specific, rng)
    out.push(...shuffled)
    if (general !== null) out.push(general)
  }
  out.push(...catchAll)
  return out
}

/**
 * Button rules: the only invariant in practice.yaml is the trailing
 * `condition: {}` catch-all. Shuffle everything except trailing catch-alls
 * (which stay at the end in their original order).
 */
function permuteButtonRules(rules, rng) {
  const head = []
  const tail = []
  for (const rule of rules) {
    if (isCatchAllCondition(rule.condition ?? {})) {
      tail.push(rule)
    } else {
      head.push(rule)
    }
  }
  return [...seededShuffle(head, rng), ...tail]
}

/**
 * Symbol dial / keypad rows: shuffle the 6 symbols inside each row, then
 * shuffle row order. Game engine semantics treat columns / sequences
 * commutatively for purposes of "which row contains all referenced symbols",
 * so permutation within and across rows preserves solvability.
 */
function permuteRowsOfSymbols(rows, rng) {
  const innerPermuted = rows.map((row) => seededShuffle(row, rng))
  return seededShuffle(innerPermuted, rng)
}

// ---------- Manual derivation ----------
export function deriveDailyManual(practiceManual, dateString) {
  const seed = fnv1a32(dateString)
  const rng = mulberry32(seed)

  // structuredClone is available on Node 17+.
  const out = structuredClone(practiceManual)
  out.meta = { version: dateString, type: 'daily' }

  // wire_routing
  out.modules.wire_routing.rules = permuteWireRules(out.modules.wire_routing.rules, rng)

  // symbol_dial — preserve `rule` string verbatim, permute columns
  out.modules.symbol_dial.columns = permuteRowsOfSymbols(out.modules.symbol_dial.columns, rng)

  // button
  out.modules.button.rules = permuteButtonRules(out.modules.button.rules, rng)

  // keypad — preserve `rule` string verbatim, permute sequences
  out.modules.keypad.sequences = permuteRowsOfSymbols(out.modules.keypad.sequences, rng)

  // decoy_modules: opaque carry-over (kept by structuredClone above)

  return out
}

// ---------- File I/O ----------
function loadPractice() {
  const text = readFileSync(PRACTICE_YAML, 'utf8')
  return yaml.load(text)
}

function dumpYaml(obj) {
  // Use default block style for readability + git diffability; lineWidth -1
  // avoids YAML's 80-col line wrapping (matches build.ts conventions).
  return yaml.dump(obj, { lineWidth: -1 })
}

export function writeDailyIfChanged(date, content, targetDir = DAILY_DIR) {
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const target = join(targetDir, `${date}.yaml`)
  if (existsSync(target)) {
    const existing = readFileSync(target, 'utf8')
    if (existing === content) return 'skip'
    throw new Error(
      `Refusing to overwrite ${target}: content differs from regenerated output. ` +
        `Either delete the existing file (and regenerate) or investigate the divergence.`
    )
  }
  writeFileSync(target, content)
  return 'write'
}

// ---------- Main ----------
function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.from || !args.days || !Number.isFinite(args.days) || args.days <= 0) usage()
  if (!isValidDateString(args.from)) {
    process.stderr.write(`Invalid --from date: ${args.from} (expected YYYY-MM-DD)\n`)
    process.exit(1)
  }

  const practice = loadPractice()
  let wrote = 0
  let skipped = 0
  for (const date of iterateDates(args.from, args.days)) {
    const derived = deriveDailyManual(practice, date)
    const text = dumpYaml(derived)
    const result = writeDailyIfChanged(date, text)
    if (result === 'write') wrote++
    else skipped++
  }

  process.stdout.write(
    `Generated ${wrote} new daily YAML(s); skipped ${skipped} unchanged. ` +
      `Total daily files now in ${DAILY_DIR}: ${
        readdirSync(DAILY_DIR).filter((f) => f.endsWith('.yaml')).length
      }\n`
  )
}

// Only run when invoked directly, not when imported by tests.
const invokedDirectly = fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) {
  main()
}
