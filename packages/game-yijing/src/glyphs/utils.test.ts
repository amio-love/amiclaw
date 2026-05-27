import { describe, it, expect } from 'vitest'
import {
  coinsToYao,
  binaryKey,
  hexagramFromBinary,
  changedValues,
  changingLines,
  yaoLabel,
  yaoShort,
  type YaoValue,
  type CoinSide,
} from './utils'

describe('coinsToYao', () => {
  it('three heads sum to 9 (老阳)', () => {
    const sides: readonly CoinSide[] = ['heads', 'heads', 'heads']
    expect(coinsToYao(sides)).toBe(9)
  })

  it('three tails sum to 6 (老阴)', () => {
    const sides: readonly CoinSide[] = ['tails', 'tails', 'tails']
    expect(coinsToYao(sides)).toBe(6)
  })

  it('two heads + one tail sum to 8 (少阴)', () => {
    expect(coinsToYao(['heads', 'heads', 'tails'])).toBe(8)
  })

  it('one head + two tails sum to 7 (少阳)', () => {
    expect(coinsToYao(['heads', 'tails', 'tails'])).toBe(7)
  })
})

describe('binaryKey', () => {
  it('all-yang sextet of 少阳 (7) maps to 111111 (乾)', () => {
    expect(binaryKey([7, 7, 7, 7, 7, 7])).toBe('111111')
  })

  it('all-yin sextet of 少阴 (8) maps to 000000 (坤)', () => {
    expect(binaryKey([8, 8, 8, 8, 8, 8])).toBe('000000')
  })

  it('treats 老阳 (9) as yang bit and 老阴 (6) as yin bit', () => {
    // bottom-up: position 0 (初爻) is leftmost in the key
    expect(binaryKey([9, 6, 9, 6, 9, 6])).toBe('101010')
  })
})

describe('hexagramFromBinary', () => {
  it('maps all-yang sextet to King Wen #1 乾', () => {
    expect(hexagramFromBinary([7, 7, 7, 7, 7, 7])).toEqual([1, '乾', 'The Creative'])
  })

  it('maps all-yin sextet to King Wen #2 坤', () => {
    expect(hexagramFromBinary([8, 8, 8, 8, 8, 8])).toEqual([2, '坤', 'The Receptive'])
  })

  it('maps alternating yang/yin (101010) to King Wen #63 既济', () => {
    // [少阳, 少阴, 少阳, 少阴, 少阳, 少阴] → binary '101010' → 既济
    expect(hexagramFromBinary([7, 8, 7, 8, 7, 8])).toEqual([63, '既济', 'After Completion'])
  })

  it('returns [0, "?", "Unknown"] fallback for unknown binary keys', () => {
    // empty sextet → '' (not a KW_LOOKUP key) → fallback
    expect(hexagramFromBinary([])).toEqual([0, '?', 'Unknown'])
  })
})

describe('changedValues', () => {
  it('passes through an all-static sextet unchanged (本卦 == 变卦)', () => {
    const sextet: readonly YaoValue[] = [7, 8, 7, 8, 7, 8]
    expect(changedValues(sextet)).toEqual([7, 8, 7, 8, 7, 8])
  })

  it('flips every yao when all six are changing (老阳→阴, 老阴→阳)', () => {
    expect(changedValues([6, 9, 6, 9, 6, 9])).toEqual([7, 8, 7, 8, 7, 8])
  })

  it('flips only the changing positions in a mixed sextet', () => {
    // positions 1 (9 → 8) and 3 (6 → 7) are the only changers
    expect(changedValues([7, 9, 8, 6, 7, 8])).toEqual([7, 8, 8, 7, 7, 8])
  })
})

describe('changingLines', () => {
  it('returns an empty array when no yao are changing', () => {
    expect(changingLines([7, 8, 7, 8, 7, 8])).toEqual([])
  })

  it('returns all six zero-indexed positions when every yao is changing', () => {
    expect(changingLines([6, 9, 6, 9, 6, 9])).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('returns only the indices of 6 / 9 yao in a mixed sextet', () => {
    expect(changingLines([7, 9, 8, 6, 7, 8])).toEqual([1, 3])
  })
})

describe('yaoLabel', () => {
  it('returns the changing-yang label for 9', () => {
    expect(yaoLabel(9)).toBe('老阳 · 变')
  })

  it('returns the static-yin label for 8', () => {
    expect(yaoLabel(8)).toBe('少阴')
  })
})

describe('yaoShort', () => {
  it('returns the changing-yin glyph hint for 6', () => {
    expect(yaoShort(6)).toBe('⚋ → ⚊')
  })

  it('returns the static-yang glyph for 7', () => {
    expect(yaoShort(7)).toBe('⚊')
  })
})
