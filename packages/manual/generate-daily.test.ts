/**
 * Unit tests for the daily-manual generator script.
 *
 * The generator lives at `scripts/generate-daily-from-practice.mjs` (root) and
 * exports pure helpers we exercise here. We do NOT shell out — we import the
 * pure derivation function directly and assert determinism + structural
 * invariants on a small set of dates.
 */
import { afterAll, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  deriveDailyManual,
  fnv1a32,
  mulberry32,
  seededShuffle,
  writeDailyIfChanged,
  // @ts-expect-error JS module imported from .mjs without types
} from '../../scripts/generate-daily-from-practice.mjs'
import { validateManualSymbols, type Manual } from '@shared/manual-schema'
import { SYMBOLS } from '@shared/symbols'

const PRACTICE_YAML = resolve(__dirname, 'data/practice.yaml')

function loadPractice(): Manual {
  return yaml.load(readFileSync(PRACTICE_YAML, 'utf8')) as Manual
}

describe('daily generator — deterministic RNG primitives', () => {
  it('fnv1a32 is stable for a known input', () => {
    // Pin the hash so a future implementation swap is loud, not silent.
    const h = fnv1a32('2026-05-12') as number
    expect(typeof h).toBe('number')
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(2 ** 32)
    // Two different dates → different hashes
    expect(fnv1a32('2026-05-12')).not.toBe(fnv1a32('2026-05-13'))
  })

  it('fnv1a32 emits the exact FNV-1a 32-bit values for pinned dates', () => {
    // Pin the EXACT numeric output of FNV-1a/32 for three known dates so a
    // silent swap to a different hash family (or a subtle off-by-one in the
    // constants) fails this test instead of slipping into production and
    // shifting every daily seed.
    expect(fnv1a32('2026-05-12')).toBe(1656106231)
    expect(fnv1a32('2026-12-31')).toBe(1294366724)
    expect(fnv1a32('2027-01-01')).toBe(1431789288)
  })

  it('mulberry32 is reproducible for a given seed', () => {
    const a = mulberry32(123) as () => number
    const b = mulberry32(123) as () => number
    for (let i = 0; i < 16; i++) {
      expect(a()).toBe(b())
    }
  })

  it('seededShuffle is deterministic per RNG seed and does not mutate input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const rngA = mulberry32(7) as () => number
    const rngB = mulberry32(7) as () => number
    const outA = seededShuffle(input, rngA) as number[]
    const outB = seededShuffle(input, rngB) as number[]
    expect(outA).toEqual(outB)
    expect(outA).not.toBe(input)
    // Input unchanged
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // Permutation has same multiset
    expect(outA.slice().sort()).toEqual(input.slice().sort())
  })
})

describe('daily generator — deriveDailyManual', () => {
  it('produces byte-equal output for the same date (determinism)', () => {
    const practice = loadPractice()
    const a = deriveDailyManual(practice, '2026-05-12')
    const b = deriveDailyManual(practice, '2026-05-12')
    expect(yaml.dump(a)).toBe(yaml.dump(b))
  })

  it('produces different output for different dates', () => {
    const practice = loadPractice()
    const a = deriveDailyManual(practice, '2026-05-12')
    const b = deriveDailyManual(practice, '2026-05-13')
    expect(yaml.dump(a)).not.toBe(yaml.dump(b))
  })

  it('sets meta correctly', () => {
    const practice = loadPractice()
    const m = deriveDailyManual(practice, '2026-07-04') as Manual
    expect(m.meta.version).toBe('2026-07-04')
    expect(m.meta.type).toBe('daily')
  })

  it('keeps wire_routing condition: {} catch-all last', () => {
    const practice = loadPractice()
    const m = deriveDailyManual(practice, '2026-05-12') as Manual
    const rules = m.modules.wire_routing.rules
    const last = rules[rules.length - 1]
    expect(Object.keys(last.condition).length).toBe(0)
  })

  it('keeps trailing button condition: {} catch-all last', () => {
    const practice = loadPractice()
    const m = deriveDailyManual(practice, '2026-05-12') as Manual
    const rules = m.modules.button.rules
    const last = rules[rules.length - 1]
    expect(Object.keys(last.condition).length).toBe(0)
  })

  it('keeps general wire-count fallthrough rules after their specific siblings', () => {
    const practice = loadPractice()
    const m = deriveDailyManual(practice, '2026-05-12') as Manual
    const rules = m.modules.wire_routing.rules
    // Find general rules: condition has wire_count and only wire_count.
    const generalIndices: number[] = []
    rules.forEach((r, i) => {
      const keys = Object.keys(r.condition)
      if (keys.length === 1 && keys[0] === 'wire_count') generalIndices.push(i)
    })
    // For each general rule, every preceding rule with the same wire_count
    // must be a specific (additional-keys) rule, not a different general.
    for (const gi of generalIndices) {
      const wc = (rules[gi].condition as { wire_count: number }).wire_count
      for (let i = 0; i < gi; i++) {
        const condI = rules[i].condition as Record<string, unknown>
        if (condI.wire_count === wc) {
          expect(
            Object.keys(condI).length,
            `general fallthrough for wire_count=${wc} at index ${gi} was preceded by another bare general at index ${i}`
          ).toBeGreaterThan(1)
        }
      }
    }
  })

  it('preserves the rulebook symbol vocabulary (no new symbols introduced)', () => {
    const practice = loadPractice()
    const m = deriveDailyManual(practice, '2026-05-12') as Manual
    expect(() => validateManualSymbols(m, SYMBOLS)).not.toThrow()
  })

  it('preserves symbol_dial column count and per-column length', () => {
    const practice = loadPractice()
    const m = deriveDailyManual(practice, '2026-05-12') as Manual
    expect(m.modules.symbol_dial.columns.length).toBe(practice.modules.symbol_dial.columns.length)
    for (const col of m.modules.symbol_dial.columns) {
      expect(col.length).toBe(6)
    }
  })

  it('preserves keypad sequence count and per-sequence length', () => {
    const practice = loadPractice()
    const m = deriveDailyManual(practice, '2026-05-12') as Manual
    expect(m.modules.keypad.sequences.length).toBe(practice.modules.keypad.sequences.length)
    for (const seq of m.modules.keypad.sequences) {
      expect(seq.length).toBe(6)
    }
  })

  it('does not mutate the input practice manual', () => {
    const practice = loadPractice()
    const before = yaml.dump(practice)
    deriveDailyManual(practice, '2026-05-12')
    deriveDailyManual(practice, '2026-08-01')
    expect(yaml.dump(practice)).toBe(before)
  })
})

describe('daily generator — writeDailyIfChanged idempotency', () => {
  // Each test uses its own tempdir to avoid coupling. The optional third
  // `targetDir` arg lets us redirect away from the real
  // `packages/manual/data/daily/` without changing behavior on the script's
  // own callsite (which still defaults to DAILY_DIR).
  const tempDirs: string[] = []
  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'amiclaw-daily-test-'))
    tempDirs.push(dir)
    return dir
  }
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes a new file on first call and returns "write"', () => {
    const dir = makeTempDir()
    const result = writeDailyIfChanged('2099-01-01', 'hello: world\n', dir) as 'write' | 'skip'
    expect(result).toBe('write')
    expect(readFileSync(join(dir, '2099-01-01.yaml'), 'utf8')).toBe('hello: world\n')
  })

  it('skips when existing content matches byte-for-byte and does not touch the file', () => {
    const dir = makeTempDir()
    const date = '2099-02-02'
    const content = 'meta:\n  version: 2099-02-02\n  type: daily\n'
    writeDailyIfChanged(date, content, dir)
    const target = join(dir, `${date}.yaml`)
    const mtimeBefore = statSync(target).mtimeMs
    // Re-call with identical content: must return 'skip' and must not rewrite
    // the file (mtime stays put, content stays byte-equal).
    const result = writeDailyIfChanged(date, content, dir) as 'write' | 'skip'
    expect(result).toBe('skip')
    expect(readFileSync(target, 'utf8')).toBe(content)
    expect(statSync(target).mtimeMs).toBe(mtimeBefore)
  })

  it('throws when existing content differs from new content (refuse to overwrite)', () => {
    const dir = makeTempDir()
    const date = '2099-03-03'
    const target = join(dir, `${date}.yaml`)
    // Seed the directory with content X via plain fs to simulate a committed
    // file that diverges from what the generator would produce now.
    writeFileSync(target, 'old: content\n')
    expect(() => writeDailyIfChanged(date, 'new: content\n', dir)).toThrow(/Refusing to overwrite/)
    // File on disk must remain the original — abort, do not overwrite.
    expect(readFileSync(target, 'utf8')).toBe('old: content\n')
  })
})
