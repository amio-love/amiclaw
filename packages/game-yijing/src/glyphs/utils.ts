// Yijing glyph utility functions.
// Source: design_handoff_yijing_oracle/prototype/yijing/glyphs.jsx helpers
// (window.lookupHex / window.changedValues / window.coinsToYao / window.yaoLabel
// / window.yaoShort). `ganzhi` is a Phase-1 placeholder per handoff §9 — the
// production build should swap in a real lunar / 甲子 library.

import { getTodayString } from '@shared/date'
import { KW_LOOKUP, type HexEntry } from './kw-lookup'

/** Yao 爻 value space: 6 老阴, 7 少阳, 8 少阴, 9 老阳. */
export type YaoValue = 6 | 7 | 8 | 9

/** A hexagram's six yao, index 0 = 初爻 (bottom). */
export type YaoSextet = readonly [YaoValue, YaoValue, YaoValue, YaoValue, YaoValue, YaoValue]

/** Three coin sides — `'heads'` = 字 (3), `'tails'` = 背 (2). */
export type CoinSide = 'heads' | 'tails'

/** Trigram canonical key (Pinyin), aligned to handoff `window.TRIGRAMS`. */
export type TrigramName = 'qian' | 'dui' | 'li' | 'zhen' | 'xun' | 'kan' | 'gen' | 'kun'

/** Convert a sextet to its King Wen binary key (bottom-up, 1 = yang). */
export function binaryKey(values: readonly YaoValue[]): string {
  return values.map((v) => (v === 7 || v === 9 ? '1' : '0')).join('')
}

/** Look up a hexagram entry by sextet. Returns a fallback when unknown. */
export function hexagramFromBinary(values: readonly YaoValue[]): HexEntry {
  const entry = KW_LOOKUP[binaryKey(values)]
  return entry ?? [0, '?', 'Unknown']
}

/** Sum three coin sides into a yao value (heads = 3, tails = 2). */
export function coinsToYao(sides: readonly CoinSide[]): YaoValue {
  const sum = sides.reduce((s, c) => s + (c === 'heads' ? 3 : 2), 0)
  // sum is always 6, 7, 8, or 9 for three sides
  return sum as YaoValue
}

/** Long human label for a yao value. */
export function yaoLabel(v: YaoValue): string {
  return { 6: '老阴 · 变', 7: '少阳', 8: '少阴', 9: '老阳 · 变' }[v]
}

/** Compact glyph hint for a yao value. */
export function yaoShort(v: YaoValue): string {
  return { 6: '⚋ → ⚊', 7: '⚊', 8: '⚋', 9: '⚊ → ⚋' }[v]
}

/** Flip changing yao (6/9) to their complements; static yao (7/8) pass through. */
export function changedValues(values: readonly YaoValue[]): YaoValue[] {
  return values.map((v) => (v === 6 ? 7 : v === 9 ? 8 : v))
}

/** Zero-indexed positions of changing yao (value 6 or 9). */
export function changingLines(values: readonly YaoValue[]): number[] {
  const out: number[] = []
  values.forEach((v, i) => {
    if (v === 6 || v === 9) out.push(i)
  })
  return out
}

const TIANGAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const
const DIZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const

/**
 * Placeholder 干支 (sexagenary cycle) label for a product day.
 *
 * Takes the shared `YYYY-MM-DD` product-day string (the UTC date — see
 * `@shared/date`), so the label always agrees with the arcade shell's daily
 * reset and with the Gregorian date shown next to it. Per handoff §9:
 * "production should swap in a real lunar / 甲子 library" — this naive offset
 * against the 1984-02-02 甲子 epoch is accurate enough for scaffold display
 * but must not be used for actual divination logic.
 */
export function ganzhi(isoDate: string = getTodayString()): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const epoch = Date.UTC(1984, 1, 2) // 1984-02-02 = 甲子
  const day = Math.round((Date.UTC(y, m - 1, d) - epoch) / 86_400_000)
  const idx = ((day % 60) + 60) % 60
  return `${TIANGAN[idx % 10]}${DIZHI[idx % 12]}`
}
