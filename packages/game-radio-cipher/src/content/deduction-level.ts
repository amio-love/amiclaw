/**
 * Radio Cipher deduction-level content (the "未知偏移·推理局", mirroring fixture
 * rc-demo-002's seg-1 / seg-2 / seg-3 ids and cipher structure).
 *
 * This is the SSOT for the CONCRETE linguistic cipher of level 2 — the same
 * role tutorial-level.ts plays for level 1 (see that file's header). What makes
 * level 2 a DEDUCTION level: the engine level's cipher_key carries the METHOD
 * (caesar_shift) but NO shift_amount, so the decoder must DERIVE the offset from
 * the frequency hint plus the listener's reported syllables.
 *
 * The derivation the codebook teaches (a classic Caesar frequency attack):
 *   1. The frequency hint says the plaintext's most-frequent final is `a`.
 *   2. Across the Caesar segments the reported (ciphered) finals are
 *      ai, ai, ai, ao — most frequent = `ai`. That `ai` IS the shifted `a`.
 *   3. Ring distance a(0) → ai(5) forward = 5 = the shift.
 *   4. Decrypt every syllable by rotating its final back 5 steps.
 * The level ships only the most-frequent hint: a least-frequent cross-check is
 * unsound here because the listener also reports the reverse segment's finals,
 * so counting all reported finals leaves the least-frequent value ambiguous.
 *
 * Information partition holds exactly as in level 1: the codebook page never
 * imports this module, so `plaintext` can never leak onto the shareable page.
 */

import { syl, type PlayableSegment } from './tutorial-level'

/** The shared Caesar offset the decoder must derive (never given on the key). */
export const DEDUCTION_SHIFT = 5

/**
 * seg-1 — ANIMAL, Caesar +5.  蚂蚱 (mà zha) -> 买摘 (mǎi zhāi); finals a,a -> ai,ai.
 * seg-2 — NUMBER, Caesar +5.  八十 (bā shí) -> 白少 (bái shǎo); finals a,i -> ai,ao.
 *   (seg-1 + seg-2 share one unknown shift; plaintext finals a,a,a,i → most = a.)
 * seg-3 — COLOR, reverse.     黑白 (hēi bái) -> 白黑 (bái hēi); order reversed.
 */
export const DEDUCTION_SEGMENTS: PlayableSegment[] = [
  {
    id: 'seg-1',
    label: '段一',
    category: 'animal',
    method: 'caesar_shift',
    shift: DEDUCTION_SHIFT,
    plaintext: {
      word: '蚂蚱',
      syllables: [syl('m', 'a', '蚂'), syl('zh', 'a', '蚱')],
    },
    ciphered: [syl('m', 'ai', '买'), syl('zh', 'ai', '摘')],
  },
  {
    id: 'seg-2',
    label: '段二',
    category: 'number_word',
    method: 'caesar_shift',
    shift: DEDUCTION_SHIFT,
    plaintext: {
      word: '八十',
      syllables: [syl('b', 'a', '八'), syl('sh', 'i', '十')],
    },
    ciphered: [syl('b', 'ai', '白'), syl('sh', 'ao', '少')],
  },
  {
    id: 'seg-3',
    label: '段三',
    category: 'color',
    method: 'reverse',
    plaintext: {
      word: '黑白',
      syllables: [syl('h', 'ei', '黑'), syl('b', 'ai', '白')],
    },
    ciphered: [syl('b', 'ai', '白'), syl('h', 'ei', '黑')],
  },
]
