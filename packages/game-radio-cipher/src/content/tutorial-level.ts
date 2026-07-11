/**
 * Radio Cipher tutorial-level content (the "新手训练电台", mirroring fixture
 * rc-demo-001's seg-1 / seg-2 ids and cipher structure).
 *
 * This file is the SSOT for the CONCRETE linguistic cipher — the plaintext
 * word, its syllables, the ciphered syllables, and the anchor 汉字 that the
 * Web Speech TTS actually speaks. The engine fixture models only the cipher
 * STRUCTURE (method, key, category, length); it cannot represent any of the
 * concrete content below (see engine-findings). Both layers share the seg ids.
 *
 * Information partition: `plaintext` and `ciphered` are LISTENER-side content.
 * The codebook page never imports this module (see game/codebook.ts) — it
 * derives its decoder-safe view straight from the engine, so the plaintext
 * answer can never leak onto the codebook.
 */

import type { Final, Syllable } from '../codec/finals-ring'

export type CipherMethod = 'caesar_shift' | 'reverse'

export interface AnchoredSyllable extends Syllable {
  /** Anchor 汉字 a human / TTS reads for this syllable (pinyin can't be spoken). */
  hanzi: string
}

/** The fixture cipher_segment.plaintext_category enum. */
export type PlaintextCategory = 'animal' | 'color' | 'number_word' | 'direction' | 'weather'

export interface PlayableSegment {
  /** Mirrors the fixture element id (seg-1 / seg-2 / …). */
  id: string
  /** Human label for the segment (段一 / 段二 / 段三). */
  label: string
  /** Mirrors the fixture cipher_segment.plaintext_category. */
  category: PlaintextCategory
  method: CipherMethod
  /** Caesar shift amount; undefined for the self-inverse reverse method. */
  shift?: number
  /** The real plaintext word (LISTENER answer). NEVER rendered on the codebook. */
  plaintext: {
    word: string
    syllables: AnchoredSyllable[]
  }
  /** Ciphered syllables in TRANSMISSION order (the exact order the audio plays). */
  ciphered: AnchoredSyllable[]
}

export function syl(initial: string, final: Final, hanzi: string): AnchoredSyllable {
  return { initial, final, hanzi }
}

/**
 * seg-1 — ANIMAL, Caesar +3 on the finals ring.
 *   plaintext 猴子 (hóu zi) -> encrypt +3 -> 航在 (háng zài)
 *   ring: ou(8)->ang(11), i(2)->ai(5); decrypt = 回拨 3 格.
 *
 * seg-2 — COLOR, syllable-order reversal (self-inverse, no key).
 *   plaintext 紫色 (zǐ sè) -> reverse -> 色紫 (sè zǐ); decrypt = 倒着念.
 */
export const TUTORIAL_SEGMENTS: PlayableSegment[] = [
  {
    id: 'seg-1',
    label: '段一',
    category: 'animal',
    method: 'caesar_shift',
    shift: 3,
    plaintext: {
      word: '猴子',
      syllables: [syl('h', 'ou', '猴'), syl('z', 'i', '子')],
    },
    ciphered: [syl('h', 'ang', '航'), syl('z', 'ai', '在')],
  },
  {
    id: 'seg-2',
    label: '段二',
    category: 'color',
    method: 'reverse',
    plaintext: {
      word: '紫色',
      syllables: [syl('z', 'i', '紫'), syl('s', 'e', '色')],
    },
    ciphered: [syl('s', 'e', '色'), syl('z', 'i', '紫')],
  },
]
