/**
 * Finals-ring codec + tutorial-content validity tests. These are the
 * correctness contract for the playable layer's cipher: the ring order must
 * match the fixture, the codec must round-trip, and every authored segment
 * must satisfy the content-validity rules (a)/(b)/(c).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadGameType } from '@amiclaw/creation'
import { TUTORIAL_SEGMENTS } from '../content/tutorial-level'
import { validateSegment } from '../content/validate-content'
import {
  caesarDecryptSyllable,
  caesarEncryptSyllable,
  FINALS_RING,
  isRealSyllable,
  isRingFinal,
  reverseSyllables,
  shiftFinal,
  syllablePinyin,
} from './finals-ring'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'creation',
  'fixtures',
  'radio-cipher'
)
const gameType = loadGameType(readFileSync(join(fixturesDir, 'game-type.yaml'), 'utf8'))

describe('finals ring', () => {
  it('matches the fixture frequency_hint.target_syllable enum order exactly', () => {
    const frequencyHint = gameType.element_archetypes.find((a) => a.id === 'frequency_hint')
    const enumValues = frequencyHint?.attributes.find(
      (attr) => attr.name === 'target_syllable'
    )?.values
    expect(enumValues).toEqual([...FINALS_RING])
  })

  it('has 13 distinct finals', () => {
    expect(FINALS_RING).toHaveLength(13)
    expect(new Set(FINALS_RING).size).toBe(13)
  })

  it('recognizes ring finals and rejects non-ring finals', () => {
    expect(isRingFinal('ang')).toBe(true)
    expect(isRingFinal('ou')).toBe(true)
    expect(isRingFinal('iong')).toBe(false)
    expect(isRingFinal('uo')).toBe(false)
  })
})

describe('shiftFinal', () => {
  it('rotates forward by 3 and wraps around the ring', () => {
    expect(shiftFinal('ou', 3)).toBe('ang') // index 8 -> 11
    expect(shiftFinal('i', 3)).toBe('ai') // index 2 -> 5
    expect(shiftFinal('en', 3)).toBe('a') // index 10 -> 0 (wrap)
    expect(shiftFinal('eng', 3)).toBe('i') // index 12 -> 2 (wrap)
  })

  it('is invertible: +n then -n returns the original', () => {
    for (const final of FINALS_RING) {
      for (const steps of [1, 3, 5, 13, -4]) {
        expect(shiftFinal(shiftFinal(final, steps), -steps)).toBe(final)
      }
    }
  })

  it('treats a full 13-step rotation as identity', () => {
    for (const final of FINALS_RING) {
      expect(shiftFinal(final, 13)).toBe(final)
    }
  })
})

describe('caesar syllable round trip', () => {
  it('encrypts then decrypts back to the original syllable', () => {
    const syllable = { initial: 'h', final: 'ou' } as const
    const encrypted = caesarEncryptSyllable(syllable, 3)
    expect(syllablePinyin(encrypted)).toBe('hang')
    expect(caesarDecryptSyllable(encrypted, 3)).toEqual(syllable)
  })
})

describe('reverseSyllables', () => {
  it('is self-inverse', () => {
    const syllables = [
      { initial: 'z', final: 'i' },
      { initial: 's', final: 'e' },
    ] as const
    expect(reverseSyllables(reverseSyllables(syllables))).toEqual([...syllables])
  })
})

describe('isRealSyllable', () => {
  it('accepts real ring-final syllables', () => {
    for (const pinyin of ['hang', 'zai', 'se', 'zi', 'hou', 'mo']) {
      expect(isRealSyllable(pinyin)).toBe(true)
    }
  })

  it('rejects impossible combinations', () => {
    for (const pinyin of ['fi', 'len', 'ba0', 'gio']) {
      expect(isRealSyllable(pinyin)).toBe(false)
    }
  })
})

describe('tutorial content validity', () => {
  it('every segment passes checks (a) ring finals, (b) real ciphered syllables, (c) round trip', () => {
    for (const segment of TUTORIAL_SEGMENTS) {
      expect(validateSegment(segment)).toEqual([])
    }
  })

  it('mirrors the fixture segment ids', () => {
    expect(TUTORIAL_SEGMENTS.map((s) => s.id)).toEqual(['seg-1', 'seg-2'])
  })

  it('flags a corrupted segment (Caesar shift landing on a broken round trip)', () => {
    const broken = structuredClone(TUTORIAL_SEGMENTS[0])
    broken.ciphered[0].final = 'eng' // no longer +3 of the plaintext final
    expect(validateSegment(broken).length).toBeGreaterThan(0)
  })
})
