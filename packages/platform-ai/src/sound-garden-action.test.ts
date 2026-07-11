import { describe, it, expect } from 'vitest'
import {
  CO_BUILD_VERBS,
  SOUND_GARDEN_PIECE_TYPES,
  parseCoBuildActions,
} from './sound-garden-action'

/**
 * The strict co_build parse-guard: valid moves parse (accepting either wire
 * `piece_type` or `pieceType`), a validly-empty array yields `[]`, and ANY
 * structural violation drops the WHOLE set (`null`) — never throws. Game-specific
 * legality (lane / range / material) is NOT enforced here; only shape.
 */
describe('parseCoBuildActions', () => {
  it('exposes the aligned verb vocabulary', () => {
    expect(CO_BUILD_VERBS).toEqual(['place', 'remove'])
  })

  it('exposes the authoritative 8-element Sound Garden vocabulary', () => {
    expect(SOUND_GARDEN_PIECE_TYPES).toEqual([
      'kick',
      'snare',
      'hihat',
      'clap',
      'bell',
      'chime',
      'flute',
      'harp',
    ])
  })

  it('parses every element of the authoritative vocabulary', () => {
    for (const pieceType of SOUND_GARDEN_PIECE_TYPES) {
      expect(parseCoBuildActions(`[{"op":"place","piece_type":"${pieceType}","slot":1}]`)).toEqual([
        { op: 'place', pieceType, slot: 1 },
      ])
    }
  })

  it('parses a single valid place action', () => {
    expect(parseCoBuildActions('[{"op":"place","piece_type":"kick","slot":1}]')).toEqual([
      { op: 'place', pieceType: 'kick', slot: 1 },
    ])
  })

  it('parses multiple valid actions preserving order', () => {
    expect(
      parseCoBuildActions(
        '[{"op":"place","piece_type":"kick","slot":1},{"op":"remove","piece_type":"snare","slot":3}]'
      )
    ).toEqual([
      { op: 'place', pieceType: 'kick', slot: 1 },
      { op: 'remove', pieceType: 'snare', slot: 3 },
    ])
  })

  it('accepts camelCase pieceType as well as snake_case piece_type', () => {
    expect(parseCoBuildActions('[{"op":"place","pieceType":"bell","slot":2}]')).toEqual([
      { op: 'place', pieceType: 'bell', slot: 2 },
    ])
  })

  it('treats a validly-empty array as no actions', () => {
    expect(parseCoBuildActions('[]')).toEqual([])
  })

  it('treats an empty / whitespace body as no actions', () => {
    expect(parseCoBuildActions('')).toEqual([])
    expect(parseCoBuildActions('   ')).toEqual([])
  })

  it('tolerates a ```json code fence around the array', () => {
    expect(
      parseCoBuildActions('```json\n[{"op":"place","piece_type":"kick","slot":1}]\n```')
    ).toEqual([{ op: 'place', pieceType: 'kick', slot: 1 }])
  })

  it('rejects invalid JSON (null, whole set dropped)', () => {
    expect(parseCoBuildActions('[{"op":"place",')).toBeNull()
    expect(parseCoBuildActions('not json at all')).toBeNull()
  })

  it('rejects a non-array body (object)', () => {
    expect(parseCoBuildActions('{"op":"place","piece_type":"kick","slot":1}')).toBeNull()
  })

  it('rejects an unknown / forged verb', () => {
    expect(parseCoBuildActions('[{"op":"destroy","piece_type":"kick","slot":1}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"","piece_type":"kick","slot":1}]')).toBeNull()
  })

  it('rejects a non-string / empty / missing piece type', () => {
    expect(parseCoBuildActions('[{"op":"place","piece_type":42,"slot":1}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":"","slot":1}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","slot":1}]')).toBeNull()
  })

  it('accepts a vocabulary display label and normalizes it to the enum id (军鼓 → snare)', () => {
    expect(parseCoBuildActions('[{"op":"place","piece_type":"军鼓","slot":3}]')).toEqual([
      { op: 'place', pieceType: 'snare', slot: 3 },
    ])
    // Every Chinese display label maps back to its canonical id.
    const labelToId: Array<[string, string]> = [
      ['底鼓', 'kick'],
      ['军鼓', 'snare'],
      ['踩镲', 'hihat'],
      ['拍掌', 'clap'],
      ['铃铛', 'bell'],
      ['风铃', 'chime'],
      ['笛音', 'flute'],
      ['竖琴', 'harp'],
    ]
    for (const [label, id] of labelToId) {
      expect(parseCoBuildActions(`[{"op":"place","piece_type":"${label}","slot":1}]`)).toEqual([
        { op: 'place', pieceType: id, slot: 1 },
      ])
    }
  })

  it('rejects a Chinese label OUTSIDE the vocabulary (labels stay vocabulary-bounded)', () => {
    // A real-sounding but non-vocabulary label must still drop the whole set.
    expect(parseCoBuildActions('[{"op":"place","piece_type":"小提琴","slot":1}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":"鼓","slot":1}]')).toBeNull()
  })

  it('rejects a forged piece type outside the vocabulary', () => {
    expect(parseCoBuildActions('[{"op":"place","piece_type":"drum","slot":1}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":"guitar","slot":1}]')).toBeNull()
    // A hostile element name (would be a forged move on the client board).
    expect(parseCoBuildActions('[{"op":"remove","piece_type":"__proto__","slot":1}]')).toBeNull()
  })

  it('rejects a typo / wrong-case of a real element (exact-token match only)', () => {
    expect(parseCoBuildActions('[{"op":"place","piece_type":"Kick","slot":1}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":"kicks","slot":1}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":"bel","slot":1}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":" kick","slot":1}]')).toBeNull()
  })

  it('drops the whole set when one action names an unknown element', () => {
    expect(
      parseCoBuildActions(
        '[{"op":"place","piece_type":"kick","slot":1},{"op":"place","piece_type":"tuba","slot":2}]'
      )
    ).toBeNull()
  })

  it('rejects a non-integer / non-positive slot (1-based)', () => {
    expect(parseCoBuildActions('[{"op":"place","piece_type":"kick","slot":1.5}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":"kick","slot":0}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":"kick","slot":-2}]')).toBeNull()
    expect(parseCoBuildActions('[{"op":"place","piece_type":"kick","slot":"1"}]')).toBeNull()
  })

  it('drops the WHOLE set when any one action is invalid (reject-on-invalid)', () => {
    expect(
      parseCoBuildActions(
        '[{"op":"place","piece_type":"kick","slot":1},{"op":"place","piece_type":"snare","slot":0}]'
      )
    ).toBeNull()
  })

  it('rejects a non-object array element', () => {
    expect(parseCoBuildActions('["place kick at 1"]')).toBeNull()
    expect(parseCoBuildActions('[null]')).toBeNull()
  })
})
