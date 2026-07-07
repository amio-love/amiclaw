import { describe, expect, it } from 'vitest'
import { KW_LOOKUP } from '../glyphs/kw-lookup'
import { HEXAGRAMS, hexagramByNumber, manual } from './index'

/* Dataset integrity — the full 64-hexagram manual.
 *
 * Structural facts (names, line yin/yang, trigrams) are cross-checked against
 * KW_LOOKUP's King Wen binary keys, so a transposed line or a mislabeled
 * trigram in any of the 64 entries fails here mechanically. */

// number → bottom-up binary key, derived by reversing KW_LOOKUP.
const BINARY_BY_NUMBER = new Map<number, string>(
  Object.entries(KW_LOOKUP).map(([binary, [num]]) => [num, binary])
)

// Bottom-up 3-bit key → the manual's trigram label.
const TRIGRAM_BY_BITS: Record<string, string> = {
  '111': '乾 (天)',
  '000': '坤 (地)',
  '100': '震 (雷)',
  '011': '巽 (风)',
  '010': '坎 (水)',
  '101': '离 (火)',
  '001': '艮 (山)',
  '110': '兑 (泽)',
}

const POSITION_CN = ['二', '三', '四', '五']

function expectedLineName(index: number, yang: boolean): string {
  if (index === 0) return yang ? '初九' : '初六'
  if (index === 5) return yang ? '上九' : '上六'
  return `${yang ? '九' : '六'}${POSITION_CN[index - 1]}`
}

describe('manual dataset integrity', () => {
  it('carries all 64 hexagrams in King Wen order', () => {
    expect(HEXAGRAMS).toHaveLength(64)
    expect(HEXAGRAMS.map((h) => h.number)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1))
  })

  it('metadata totals match the dataset (384 positioned lines + 用九 + 用六)', () => {
    expect(manual.metadata.total_hexagrams).toBe(64)
    expect(manual.metadata.total_lines).toBe(386)
    const positioned = manual.hexagrams.reduce((n, h) => n + h.lines.length, 0)
    const extras = manual.hexagrams.filter((h) => h.extra_line).length
    expect(positioned).toBe(384)
    expect(extras).toBe(2)
    expect(positioned + extras).toBe(manual.metadata.total_lines)
  })

  it('carries 用九 on 乾 and 用六 on 坤, and on no other hexagram', () => {
    const qian = hexagramByNumber(1)?.extra_line
    expect(qian?.label).toBe('用九')
    expect(qian?.classical).toBe('见群龙无首，吉。')
    expect(qian?.modern_interpretation.length).toBeGreaterThan(0)
    expect(qian?.changing_guidance.startsWith('六爻皆变时')).toBe(true)

    const kun = hexagramByNumber(2)?.extra_line
    expect(kun?.label).toBe('用六')
    expect(kun?.classical).toBe('利永贞。')
    expect(kun?.modern_interpretation.length).toBeGreaterThan(0)
    expect(kun?.changing_guidance.startsWith('六爻皆变时')).toBe(true)

    for (let n = 3; n <= 64; n++) {
      expect(hexagramByNumber(n)?.extra_line).toBeUndefined()
    }
  })

  it('hexagramByNumber resolves every King Wen number and only those', () => {
    for (let n = 1; n <= 64; n++) {
      expect(hexagramByNumber(n)?.number).toBe(n)
    }
    expect(hexagramByNumber(0)).toBeUndefined()
    expect(hexagramByNumber(65)).toBeUndefined()
  })

  it.each(Array.from({ length: 64 }, (_, i) => i + 1))(
    '#%i — complete fields, canonical name, lines and trigrams match the binary',
    (n) => {
      const entry = hexagramByNumber(n)
      expect(entry).toBeDefined()
      if (!entry) return
      const binary = BINARY_BY_NUMBER.get(n)
      expect(binary).toBeDefined()
      if (!binary) return

      // Chinese name matches the KW_LOOKUP canonical name.
      expect(entry.name.chinese).toBe(KW_LOOKUP[binary][1])
      expect(entry.name.pinyin.length).toBeGreaterThan(0)
      expect(entry.name.english.length).toBeGreaterThan(0)

      // Trigrams derive from the binary (bits 0-2 lower, 3-5 upper, bottom-up).
      expect(entry.trigrams.lower).toBe(TRIGRAM_BY_BITS[binary.slice(0, 3)])
      expect(entry.trigrams.upper).toBe(TRIGRAM_BY_BITS[binary.slice(3, 6)])

      // Judgment / image completeness.
      expect(entry.judgment.classical.length).toBeGreaterThan(0)
      expect(entry.judgment.modern_interpretation.length).toBeGreaterThan(0)
      expect(entry.judgment.keywords.length).toBeGreaterThan(0)
      expect(entry.image.classical.length).toBeGreaterThan(0)
      expect(entry.image.modern_interpretation.length).toBeGreaterThan(0)

      // Six lines, positions 1..6, names consistent with the binary's yin/yang.
      expect(entry.lines).toHaveLength(6)
      entry.lines.forEach((line, idx) => {
        expect(line.position).toBe(idx + 1)
        expect(line.name).toBe(expectedLineName(idx, binary[idx] === '1'))
        expect(line.classical.length).toBeGreaterThan(0)
        expect(line.modern_interpretation.length).toBeGreaterThan(0)
        expect(line.changing_guidance.startsWith('此爻变动时')).toBe(true)
      })

      // Format spot check — classical passages close with full-width final
      // punctuation (a couple of 爻辞 end on a rhetorical「？」, e.g. 随九四).
      expect(entry.judgment.classical.endsWith('。')).toBe(true)
      expect(entry.image.classical.endsWith('。')).toBe(true)
      for (const line of entry.lines) {
        expect(/[。？]$/.test(line.classical)).toBe(true)
      }
    }
  )
})
