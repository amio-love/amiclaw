/**
 * Level-2 (rc-demo-002, "未知偏移·推理局") correctness contract:
 *  - the concrete content passes the same content-validity rules as level 1;
 *  - the frequency-attack derivation actually WORKS — the plaintext's
 *    most-frequent final matches the level's most_frequent hint, and the shift
 *    recovered from the ciphered finals equals the real shift, so the decoder
 *    has a genuine inference path;
 *  - the engine Level YAML expresses the "unknown shift" (key without
 *    shift_amount) and drives to a real win through the actual GameSession.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GameSession } from '@amiclaw/creation'
import { loadGameType, loadLevel } from '@amiclaw/creation'
import type { LevelElement } from '@amiclaw/creation'
import { buildCodebook } from '../game/codebook'
import { caesarDecryptSyllable, FINALS_RING, syllablePinyin } from '../codec/finals-ring'
import { validateSegment } from './validate-content'
import { DEDUCTION_SEGMENTS, DEDUCTION_SHIFT } from './deduction-level'
import { TUTORIAL_SEGMENTS } from './tutorial-level'

const here = dirname(fileURLToPath(import.meta.url))
const gameType = loadGameType(
  readFileSync(
    join(here, '..', '..', '..', 'creation', 'fixtures', 'radio-cipher', 'game-type.yaml'),
    'utf8'
  )
)
const level = loadLevel(readFileSync(join(here, 'level.rc-demo-002.yaml'), 'utf8'))

/** Most-frequent value in a list (first-seen wins ties). */
function mostFrequent<T extends string>(values: T[]): T {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

const caesarSegments = DEDUCTION_SEGMENTS.filter((segment) => segment.method === 'caesar_shift')

describe('deduction-level content validity', () => {
  it('every segment passes the content-validity checks', () => {
    for (const segment of DEDUCTION_SEGMENTS) {
      expect(validateSegment(segment)).toEqual([])
    }
  })

  it('has three segments with the fixture ids seg-1 / seg-2 / seg-3', () => {
    expect(DEDUCTION_SEGMENTS.map((s) => s.id)).toEqual(['seg-1', 'seg-2', 'seg-3'])
  })

  it('the two Caesar segments come from different categories', () => {
    expect(caesarSegments).toHaveLength(2)
    const categories = new Set(caesarSegments.map((s) => s.category))
    expect(categories.size).toBe(2)
  })

  it('the Caesar shift is not 3 (distinct from the tutorial level)', () => {
    expect(DEDUCTION_SHIFT).not.toBe(3)
    for (const segment of caesarSegments) expect(segment.shift).toBe(DEDUCTION_SHIFT)
  })
})

describe('deduction-level frequency derivation', () => {
  const plaintextFinals = caesarSegments.flatMap((s) => s.plaintext.syllables.map((y) => y.final))
  const cipheredFinals = caesarSegments.flatMap((s) => s.ciphered.map((y) => y.final))

  it("the plaintext's most-frequent final matches the level's most_frequent hint", () => {
    const hint = level.elements.find((el: LevelElement) => el.params.hint_type === 'most_frequent')
    expect(mostFrequent(plaintextFinals)).toBe(hint?.params.target_syllable)
  })

  it('the shift derived from the ciphered finals equals the real shift', () => {
    const anchor = mostFrequent(plaintextFinals) // 'a' — from the hint
    const observed = mostFrequent(cipheredFinals) // most-frequent reported final
    // Ring distance from the plaintext anchor forward to the observed cipher final.
    const derived =
      (FINALS_RING.indexOf(observed) - FINALS_RING.indexOf(anchor) + FINALS_RING.length) %
      FINALS_RING.length
    expect(derived).toBe(DEDUCTION_SHIFT)
    // And that derived shift actually decrypts every Caesar syllable.
    for (const segment of caesarSegments) {
      segment.ciphered.forEach((cipher, i) => {
        expect(syllablePinyin(caesarDecryptSyllable(cipher, derived))).toBe(
          syllablePinyin(segment.plaintext.syllables[i])
        )
      })
    }
  })

  it('ships no least_frequent hint (ambiguous once the reverse segment is reported)', () => {
    const leastHint = level.elements.find(
      (el: LevelElement) => el.params.hint_type === 'least_frequent'
    )
    expect(leastHint).toBeUndefined()
  })
})

describe('rc-demo-002 engine Level', () => {
  it('withholds the shift: key-1 has target_method but no shift_amount', () => {
    const key = level.elements.find((el: LevelElement) => el.id === 'key-1')
    expect(key?.params.target_method).toBe('caesar_shift')
    expect(key?.params.shift_amount).toBeUndefined()
  })

  it('wins only after every segment is driven to decrypted', () => {
    const session = new GameSession(gameType, level)
    expect(session.isWon()).toBe(false)
    for (const id of ['seg-1', 'seg-2', 'seg-3']) {
      let guard = 0
      while (session.getState().elements[id]?.decryption_progress !== 'decrypted' && guard < 8) {
        session.performAction('listener', 'execute_decryption', { element_id: id })
        guard += 1
      }
    }
    expect(session.isWon()).toBe(true)
  })
})

describe('codebook derivation surface', () => {
  it('level 2 exposes a derivation anchored on the most_frequent hint', () => {
    const codebook = buildCodebook(gameType, level)
    expect(codebook.derivation?.mostFrequent).toBe('a')
    // Caesar keys read as unknown-shift, not "偏移量 0".
    const caesarKeyLines = codebook.segments
      .filter((s) => s.methodLabel.includes('凯撒'))
      .map((s) => s.keyLine)
    expect(caesarKeyLines.length).toBeGreaterThan(0)
    for (const line of caesarKeyLines) expect(line).toContain('偏移量未知')
  })

  it('level 1 (given shift) exposes no derivation block', () => {
    const tutorialLevel = loadLevel(
      readFileSync(
        join(
          here,
          '..',
          '..',
          '..',
          'creation',
          'fixtures',
          'radio-cipher',
          'level.rc-demo-001.yaml'
        ),
        'utf8'
      )
    )
    const codebook = buildCodebook(gameType, tutorialLevel)
    expect(codebook.derivation).toBeUndefined()
    // sanity: the tutorial content still validates (guards the shared helper).
    for (const segment of TUTORIAL_SEGMENTS) expect(validateSegment(segment)).toEqual([])
  })
})
