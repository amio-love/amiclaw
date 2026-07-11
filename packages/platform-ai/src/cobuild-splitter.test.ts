import { describe, it, expect } from 'vitest'
import {
  ACTION_MAX_BYTES,
  CO_BUILD_CLOSE,
  CO_BUILD_OPEN,
  CoBuildSplitter,
  buildCoBuildInstruction,
} from './cobuild-splitter'
import { CO_BUILD_VERBS, parseCoBuildActions } from './sound-garden-action'
import type { CoBuildAction } from './contract'

/**
 * Drive a splitter over a delta sequence, returning the total SPEECH emitted
 * (every `push` return concatenated with the `flush` speech) and the parsed
 * actions. This is exactly how `streamLlmTts` consumes it.
 */
function run(deltas: string[]): { speech: string; actions: CoBuildAction[] } {
  const splitter = new CoBuildSplitter(parseCoBuildActions)
  let speech = ''
  for (const d of deltas) speech += splitter.push(d)
  const flushed = splitter.flush()
  speech += flushed.speech
  return { speech, actions: flushed.actions }
}

describe('CoBuildSplitter', () => {
  it('streams pure speech immediately and parses a trailing fenced action block', () => {
    const { speech, actions } = run([
      '你好，我先放一个底鼓打底。',
      `${CO_BUILD_OPEN}[{"op":"place","piece_type":"kick","slot":1}]${CO_BUILD_CLOSE}`,
    ])
    expect(speech).toBe('你好，我先放一个底鼓打底。')
    expect(actions).toEqual([{ op: 'place', pieceType: 'kick', slot: 1 }])
    // No fence byte reached the speech stream.
    expect(speech).not.toContain('<<<')
    expect(speech).not.toContain('ACTIONS')
  })

  it('detects a fence that spans a delta boundary without leaking the marker', () => {
    const { speech, actions } = run([
      '放个底鼓。<<<AC',
      'TIONS>>>[{"op":"place","piece_type":"kick","slot":1}',
      ']<<<END_ACTIONS>>>',
    ])
    expect(speech).toBe('放个底鼓。')
    expect(actions).toEqual([{ op: 'place', pieceType: 'kick', slot: 1 }])
    expect(speech).not.toContain('<<<')
  })

  it('never leaks the CLOSE marker or action-block content to speech', () => {
    const { speech } = run([
      'ok.',
      `${CO_BUILD_OPEN}[{"op":"remove","piece_type":"snare","slot":2}]${CO_BUILD_CLOSE}trailing junk`,
    ])
    expect(speech).toBe('ok.')
    expect(speech).not.toContain('END_ACTIONS')
    expect(speech).not.toContain('remove')
    expect(speech).not.toContain('trailing junk')
  })

  it('does NOT swallow a real sentence that merely ends in a fence-prefix look-alike', () => {
    // The model never opened a fence; the trailing "<<" is genuine speech and
    // must be released verbatim at stream end (delayed, not lost).
    const { speech, actions } = run(['看这里<<'])
    expect(speech).toBe('看这里<<')
    expect(actions).toEqual([])
  })

  it('releases a longer partial-prefix that never completes into a fence', () => {
    const { speech, actions } = run(['注意', '<<<ACTI'])
    expect(speech).toBe('注意<<<ACTI')
    expect(actions).toEqual([])
  })

  it('emits no action chunk when there is no fence at all', () => {
    const { speech, actions } = run(['就聊聊天，', '这一拍先不动。'])
    expect(speech).toBe('就聊聊天，这一拍先不动。')
    expect(actions).toEqual([])
  })

  it('drops actions on a parse-reject but keeps the speech', () => {
    const { speech, actions } = run([
      '我想放这个。',
      `${CO_BUILD_OPEN}[{"op":"place","piece_type":"kick"`, // malformed JSON, missing CLOSE
    ])
    expect(speech).toBe('我想放这个。')
    expect(actions).toEqual([])
  })

  it('DISCARD_ACTIONS: an over-ACTION_MAX-byte block NEVER reaches speech, yields empty actions, keeps pre-fence speech', () => {
    const huge = 'x'.repeat(ACTION_MAX_BYTES + 500)
    const { speech, actions } = run([
      'pre-fence speech stays.',
      `${CO_BUILD_OPEN}[`,
      huge,
      `]${CO_BUILD_CLOSE}`,
    ])
    // The pre-fence speech already streamed and is delivered.
    expect(speech).toBe('pre-fence speech stays.')
    // Overflow → terminal discard → empty actions.
    expect(actions).toEqual([])
    // Neither the markers nor the overflow content leaked to TTS/text.
    expect(speech).not.toContain('<<<')
    expect(speech).not.toContain('x'.repeat(50))
    expect(speech).not.toContain('END_ACTIONS')
  })

  it('DISCARD is terminal: deltas after overflow are swallowed', () => {
    const huge = 'y'.repeat(ACTION_MAX_BYTES + 100)
    const splitter = new CoBuildSplitter(parseCoBuildActions)
    let speech = splitter.push('speech.')
    speech += splitter.push(`${CO_BUILD_OPEN}${huge}`) // overflow → discard
    speech += splitter.push('this must not appear as speech')
    const flushed = splitter.flush()
    speech += flushed.speech
    expect(speech).toBe('speech.')
    expect(flushed.actions).toEqual([])
  })

  it('measures ACTION_MAX in UTF-8 BYTES, not code units (multi-byte content)', () => {
    // Each 好 is 3 UTF-8 bytes: 700 chars = 2100 bytes > 2048 → discard.
    const multibyte = '好'.repeat(700)
    const { speech, actions } = run(['前置。', `${CO_BUILD_OPEN}${multibyte}${CO_BUILD_CLOSE}`])
    expect(speech).toBe('前置。')
    expect(actions).toEqual([])
  })

  it('flush is idempotent (never double-releases the held carry)', () => {
    const splitter = new CoBuildSplitter(parseCoBuildActions)
    // '看' streams immediately; the '<<' partial-prefix is HELD for flush.
    expect(splitter.push('看<<')).toBe('看')
    expect(splitter.flush()).toEqual({ speech: '<<', actions: [] })
    expect(splitter.flush()).toEqual({ speech: '', actions: [] })
  })
})

describe('buildCoBuildInstruction', () => {
  it('names the exact fence markers and the game verb vocabulary', () => {
    const instruction = buildCoBuildInstruction({ verbs: CO_BUILD_VERBS })
    expect(instruction).toContain(CO_BUILD_OPEN)
    expect(instruction).toContain(CO_BUILD_CLOSE)
    expect(instruction).toContain('place')
    expect(instruction).toContain('remove')
  })
})
