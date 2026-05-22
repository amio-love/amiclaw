/**
 * Regression step definitions for the keypad / symbol-dial manual
 * set-discrimination guard (task fix-keypad-manual-sequence-ambiguity).
 *
 * These steps are pure data assertions — they parse the shipped manual YAML
 * and check the structural invariant; no browser navigation is involved. The
 * invariant: any two keypad sequences share at most 3 symbols and any two
 * symbol-dial columns share at most 2 symbols, so every player-visible symbol
 * subset (4 for keypad, 3 for dial) attributes to exactly one manual row.
 */
import { expect } from '@playwright/test'
import { Given, Then } from './fixtures'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import yaml from 'js-yaml'

interface ManualShape {
  modules: {
    symbol_dial: { columns: string[][] }
    keypad: { sequences: string[][] }
  }
}

const MANUAL_DATA_DIR = resolve(process.cwd(), 'packages/manual/data')

/** practice.yaml + an evenly-spaced sample of daily manuals, set by Background. */
let loadedManuals: { label: string; manual: ManualShape }[] = []

function loadManual(path: string): ManualShape {
  return yaml.load(readFileSync(path, 'utf8')) as ManualShape
}

/** Largest symbol-set intersection across every pair of rows. */
function maxPairwiseIntersection(rows: string[][]): number {
  let max = 0
  for (let i = 0; i < rows.length; i++) {
    const a = new Set(rows[i])
    for (let j = i + 1; j < rows.length; j++) {
      const shared = rows[j].reduce((n, s) => n + (a.has(s) ? 1 : 0), 0)
      if (shared > max) max = shared
    }
  }
  return max
}

/** Every k-sized subset of `row`. */
function subsets<T>(row: readonly T[], k: number): T[][] {
  const out: T[][] = []
  const walk = (start: number, acc: T[]): void => {
    if (acc.length === k) {
      out.push([...acc])
      return
    }
    for (let i = start; i < row.length; i++) {
      acc.push(row[i])
      walk(i + 1, acc)
      acc.pop()
    }
  }
  walk(0, [])
  return out
}

/** How many rows contain every symbol in `subset`. */
function matchingRowCount(rows: string[][], subset: string[]): number {
  return rows.filter((row) => subset.every((s) => row.includes(s))).length
}

Given('the practice manual and a sample of daily manuals are loaded', () => {
  const dailyDir = join(MANUAL_DATA_DIR, 'daily')
  const dailyFiles = readdirSync(dailyDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
  // Evenly-spaced sample keeps the exhaustive subset check fast while still
  // spanning the full date range derived from practice.yaml.
  const SAMPLE_SIZE = 12
  const stride = Math.max(1, Math.floor(dailyFiles.length / SAMPLE_SIZE))
  const sampled = dailyFiles.filter((_, i) => i % stride === 0)
  loadedManuals = [
    { label: 'practice.yaml', manual: loadManual(join(MANUAL_DATA_DIR, 'practice.yaml')) },
    ...sampled.map((f) => ({ label: `daily/${f}`, manual: loadManual(join(dailyDir, f)) })),
  ]
  expect(loadedManuals.length).toBeGreaterThan(1)
})

Then('any two keypad sequences in each loaded manual share at most 3 symbols', () => {
  for (const { label, manual } of loadedManuals) {
    expect(
      maxPairwiseIntersection(manual.modules.keypad.sequences),
      `${label}: two keypad sequences share more than 3 symbols`
    ).toBeLessThanOrEqual(3)
  }
})

Then('every 4-symbol subset of a keypad sequence matches exactly one sequence', () => {
  for (const { label, manual } of loadedManuals) {
    const sequences = manual.modules.keypad.sequences
    for (const seq of sequences) {
      for (const subset of subsets(seq, 4)) {
        expect(
          matchingRowCount(sequences, subset),
          `${label}: keypad subset ${JSON.stringify(subset)} does not match exactly one sequence`
        ).toBe(1)
      }
    }
  }
})

Then('any two symbol-dial columns in each loaded manual share at most 2 symbols', () => {
  for (const { label, manual } of loadedManuals) {
    expect(
      maxPairwiseIntersection(manual.modules.symbol_dial.columns),
      `${label}: two symbol-dial columns share more than 2 symbols`
    ).toBeLessThanOrEqual(2)
  }
})

Then('every 3-symbol subset of a symbol-dial column matches exactly one column', () => {
  for (const { label, manual } of loadedManuals) {
    const columns = manual.modules.symbol_dial.columns
    for (const col of columns) {
      for (const subset of subsets(col, 3)) {
        expect(
          matchingRowCount(columns, subset),
          `${label}: symbol-dial subset ${JSON.stringify(subset)} does not match exactly one column`
        ).toBe(1)
      }
    }
  }
})
