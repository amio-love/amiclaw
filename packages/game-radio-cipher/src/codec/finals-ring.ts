/**
 * Finals-ring codec for Radio Cipher.
 *
 * The 13-final ring is the cipher's key space: a Caesar-style shift rotates a
 * syllable's FINAL around the ring while keeping its INITIAL fixed. The ring
 * order is pinned to the game-type fixture's frequency_hint.target_syllable
 * enum (the single source of truth for the ring), so the playable content and
 * the engine fixture agree on the alphabet.
 *
 * The engine models decryption as an OPAQUE state advance (see the
 * engine-findings notes): it never computes the linguistic transform. This
 * module is that missing computation, living entirely in the playable layer.
 */

import { VALID_RING_SYLLABLES } from './mandarin-syllables'

/**
 * The 13-final ring, in the exact order of the game-type fixture's
 * frequency_hint.target_syllable enum. Index position IS the ring position.
 */
export const FINALS_RING = [
  'a',
  'e',
  'i',
  'o',
  'u',
  'ai',
  'ei',
  'ao',
  'ou',
  'an',
  'en',
  'ang',
  'eng',
] as const

export type Final = (typeof FINALS_RING)[number]

export interface Syllable {
  /** Pinyin initial (声母). Empty string for a zero-initial syllable. */
  initial: string
  /** Pinyin final (韵母). Must be a member of FINALS_RING. */
  final: Final
}

/** Is this string one of the 13 ring finals? */
export function isRingFinal(final: string): final is Final {
  return (FINALS_RING as readonly string[]).includes(final)
}

/**
 * Rotate a final N steps around the ring (positive = forward / encrypt
 * direction, negative = backward / decrypt direction). Wraps modulo 13.
 */
export function shiftFinal(final: Final, steps: number): Final {
  const size = FINALS_RING.length
  const index = FINALS_RING.indexOf(final)
  const next = (((index + steps) % size) + size) % size
  return FINALS_RING[next]
}

/** Recombine a syllable into its pinyin string (initial + final). */
export function syllablePinyin(syllable: Syllable): string {
  return `${syllable.initial}${syllable.final}`
}

/** Caesar-encrypt one syllable: shift its final FORWARD by `shift`. */
export function caesarEncryptSyllable(syllable: Syllable, shift: number): Syllable {
  return { initial: syllable.initial, final: shiftFinal(syllable.final, shift) }
}

/** Caesar-decrypt one syllable: shift its final BACK by `shift` (inverse). */
export function caesarDecryptSyllable(syllable: Syllable, shift: number): Syllable {
  return { initial: syllable.initial, final: shiftFinal(syllable.final, -shift) }
}

/**
 * Reverse-cipher: the whole transform is syllable-order reversal, which is
 * its own inverse (encrypt and decrypt are the same operation).
 */
export function reverseSyllables<T>(syllables: readonly T[]): T[] {
  return [...syllables].reverse()
}

/** Is a combined pinyin string a real Mandarin syllable in the ring-final space? */
export function isRealSyllable(pinyin: string): boolean {
  return VALID_RING_SYLLABLES.has(pinyin)
}
