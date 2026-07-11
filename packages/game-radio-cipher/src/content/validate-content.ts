/**
 * Content-validity checks for playable Radio Cipher segments. Guards against
 * an authoring mistake — a plaintext final off the ring, a Caesar shift that
 * lands on a non-syllable, a mismatched anchor, or a broken round trip — the
 * moment it enters the content file, via the unit tests.
 *
 * Returns a flat list of human-readable error strings ([] = valid), so a test
 * can assert emptiness AND a future authoring tool can surface the reasons.
 */

import {
  caesarDecryptSyllable,
  caesarEncryptSyllable,
  isRealSyllable,
  isRingFinal,
  reverseSyllables,
  syllablePinyin,
  type Syllable,
} from '../codec/finals-ring'
import type { PlayableSegment } from './tutorial-level'

function sameSyllable(a: Syllable, b: Syllable): boolean {
  return a.initial === b.initial && a.final === b.final
}

export function validateSegment(segment: PlayableSegment): string[] {
  const errors: string[] = []
  const where = `[${segment.id}]`
  const plain = segment.plaintext.syllables
  const cipher = segment.ciphered

  // (a) every plaintext final is a ring member.
  for (const s of plain) {
    if (!isRingFinal(s.final)) {
      errors.push(`${where} plaintext final "${s.final}" (${s.hanzi}) is not on the finals ring`)
    }
  }

  // (b) every ciphered syllable is a real Mandarin syllable with an anchor 汉字.
  for (const s of cipher) {
    const pinyin = syllablePinyin(s)
    if (!isRealSyllable(pinyin)) {
      errors.push(`${where} ciphered syllable "${pinyin}" is not a real Mandarin syllable`)
    }
    if (!s.hanzi || s.hanzi.trim() === '') {
      errors.push(`${where} ciphered syllable "${pinyin}" has no anchor 汉字`)
    }
  }

  if (cipher.length !== plain.length) {
    errors.push(`${where} ciphered length ${cipher.length} != plaintext length ${plain.length}`)
    return errors
  }

  // (c) round-trip correctness for the declared method.
  if (segment.method === 'caesar_shift') {
    if (typeof segment.shift !== 'number') {
      errors.push(`${where} caesar_shift segment is missing a numeric shift`)
      return errors
    }
    plain.forEach((p, i) => {
      const encrypted = caesarEncryptSyllable(p, segment.shift as number)
      if (!sameSyllable(encrypted, cipher[i])) {
        errors.push(
          `${where} encrypt(${syllablePinyin(p)}) = ${syllablePinyin(encrypted)}, declared ciphered = ${syllablePinyin(cipher[i])}`
        )
      }
      const decrypted = caesarDecryptSyllable(cipher[i], segment.shift as number)
      if (!sameSyllable(decrypted, p)) {
        errors.push(
          `${where} decrypt(${syllablePinyin(cipher[i])}) = ${syllablePinyin(decrypted)}, expected plaintext = ${syllablePinyin(p)}`
        )
      }
    })
  } else {
    const encrypted = reverseSyllables(plain)
    encrypted.forEach((e, i) => {
      if (!sameSyllable(e, cipher[i])) {
        errors.push(
          `${where} reverse(plaintext)[${i}] = ${syllablePinyin(e)}, declared ciphered = ${syllablePinyin(cipher[i])}`
        )
      }
    })
    const decrypted = reverseSyllables(cipher)
    decrypted.forEach((d, i) => {
      if (!sameSyllable(d, plain[i])) {
        errors.push(
          `${where} reverse(ciphered)[${i}] = ${syllablePinyin(d)}, expected plaintext = ${syllablePinyin(plain[i])}`
        )
      }
    })
  }

  return errors
}
