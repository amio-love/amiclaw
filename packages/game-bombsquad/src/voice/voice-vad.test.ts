import { describe, it, expect } from 'vitest'
import {
  computeRms,
  DEFAULT_VAD_CONFIG,
  initialVadState,
  vadStep,
  type VadConfig,
  type VadEvent,
  type VadState,
} from './voice-vad'

// Round-number config so the maths is obvious: 100ms frames, speech qualifies
// after 200ms (2 contiguous speech frames), an utterance ends after 800ms (8
// contiguous silence frames).
const CONFIG: VadConfig = { speechThreshold: 0.02, silenceHangoverMs: 800, minSpeechMs: 200 }
const FRAME_MS = 100
const SPEECH = 0.5 // clearly above threshold
const SILENCE = 0.0 // clearly below threshold

/** Fold a sequence of frame RMS values, collecting every emitted boundary event. */
function drive(rmsSeq: number[], from: VadState = initialVadState) {
  let state = from
  const events: VadEvent[] = []
  for (const rms of rmsSeq) {
    const stepped = vadStep(state, rms, FRAME_MS, CONFIG)
    state = stepped.state
    if (stepped.event) events.push(stepped.event)
  }
  return { state, events }
}

describe('computeRms', () => {
  it('is 0 for an empty frame', () => {
    expect(computeRms(new Float32Array(0))).toBe(0)
  })

  it('is 0 for pure silence', () => {
    expect(computeRms(new Float32Array(64))).toBe(0)
  })

  it('is the amplitude for a constant signal', () => {
    expect(computeRms(new Float32Array([0.5, 0.5, 0.5]))).toBeCloseTo(0.5, 6)
    expect(computeRms(new Float32Array([-1, -1, -1, -1]))).toBeCloseTo(1, 6)
  })
})

describe('vadStep — utterance detection', () => {
  it('fires speech-start exactly once after minSpeechMs of contiguous speech', () => {
    // 2 frames = 200ms reaches minSpeechMs; further speech frames do NOT re-fire.
    const { events, state } = drive([SPEECH, SPEECH, SPEECH, SPEECH])
    expect(events).toEqual(['speech-start'])
    expect(state.speaking).toBe(true)
  })

  it('does not fire on the first speech frame (below minSpeechMs)', () => {
    const { events, state } = drive([SPEECH])
    expect(events).toEqual([])
    expect(state.speaking).toBe(false)
  })

  it('fires utterance-end after silenceHangoverMs of trailing silence', () => {
    // Start speaking, then go silent. 7 silence frames (700ms) is still inside an
    // utterance; the 8th (800ms) ends it.
    const seq = [SPEECH, SPEECH, ...Array(7).fill(SILENCE)]
    const mid = drive(seq)
    expect(mid.events).toEqual(['speech-start'])
    expect(mid.state.speaking).toBe(true)

    const end = drive([SILENCE], mid.state)
    expect(end.events).toEqual(['utterance-end'])
    expect(end.state.speaking).toBe(false)
    expect(end.state).toEqual(initialVadState)
  })

  it('fires the full speech-then-silence boundary pair in one drive', () => {
    const seq = [SPEECH, SPEECH, SPEECH, ...Array(8).fill(SILENCE)]
    expect(drive(seq).events).toEqual(['speech-start', 'utterance-end'])
  })
})

describe('vadStep — noise debounce', () => {
  it('discards a single noise blip (sub-minSpeechMs speech then silence)', () => {
    // One speech frame (100ms < 200ms) then silence: never a qualified utterance.
    const { events, state } = drive([SPEECH, SILENCE, SILENCE, SILENCE])
    expect(events).toEqual([])
    expect(state).toEqual(initialVadState)
  })

  it('requires CONTIGUOUS speech — a gap resets the forming utterance', () => {
    // speech, silence, speech: each speech run is only 100ms, never reaching the
    // 200ms minimum, so no utterance starts.
    const { events } = drive([SPEECH, SILENCE, SPEECH, SILENCE, SPEECH, SILENCE])
    expect(events).toEqual([])
  })

  it('ignores steady background noise below the threshold', () => {
    const { events, state } = drive(Array(20).fill(0.01))
    expect(events).toEqual([])
    expect(state).toEqual(initialVadState)
  })
})

describe('DEFAULT_VAD_CONFIG — conservative defaults reject transients', () => {
  // The real capture frame is 4096 samples at 16 kHz ≈ 256ms, so minSpeechMs
  // (400) needs 2 contiguous speech frames to qualify; a single transient frame
  // (a stopwatch tick / click) can never reach it. These cases pin the rejection
  // of brief loud blips and of faint-but-audible ambient so a device re-tune is a
  // visible, intentional change rather than a silent regression.
  const FRAME = 256
  const TICK_LEVEL = 0.05 // a faint tick / ambient: above the OLD 0.02 floor, below 0.07

  function driveDefault(rmsSeq: number[]) {
    let state = initialVadState
    const events: VadEvent[] = []
    for (const rms of rmsSeq) {
      const stepped = vadStep(state, rms, FRAME, DEFAULT_VAD_CONFIG)
      state = stepped.state
      if (stepped.event) events.push(stepped.event)
    }
    return { state, events }
  }

  it('keeps a high speech threshold and a long min-speech window', () => {
    expect(DEFAULT_VAD_CONFIG.speechThreshold).toBeGreaterThanOrEqual(0.06)
    expect(DEFAULT_VAD_CONFIG.minSpeechMs).toBeGreaterThanOrEqual(350)
  })

  it('rejects a single loud tick frame (one 256ms transient, < minSpeechMs)', () => {
    const { events, state } = driveDefault([SPEECH, SILENCE, SILENCE, SILENCE, SILENCE])
    expect(events).toEqual([])
    expect(state).toEqual(initialVadState)
  })

  it('treats a faint tick / ambient between the old and new floor as silence', () => {
    // 0.05 crossed the old 0.02 threshold; under the 0.07 floor it is silence.
    const { events, state } = driveDefault(Array(10).fill(TICK_LEVEL))
    expect(events).toEqual([])
    expect(state).toEqual(initialVadState)
  })

  it('accepts sustained speech (>= minSpeechMs of contiguous energy)', () => {
    // 2 frames = 512ms >= 400ms minSpeechMs -> a real utterance starts.
    const { events, state } = driveDefault([SPEECH, SPEECH, SPEECH])
    expect(events).toEqual(['speech-start'])
    expect(state.speaking).toBe(true)
  })
})

describe('vadStep — mid-utterance pauses', () => {
  it('does not split a turn on a short pause shorter than the hangover', () => {
    // Speak, pause 500ms (< 800ms hangover), keep speaking: still ONE utterance.
    const seq = [
      SPEECH,
      SPEECH, // speech-start
      ...Array(5).fill(SILENCE), // 500ms pause, not enough to end
      SPEECH,
      SPEECH,
    ]
    const { events, state } = drive(seq)
    expect(events).toEqual(['speech-start'])
    expect(state.speaking).toBe(true)
  })

  it('resets the silence counter when speech resumes mid-utterance', () => {
    // After resuming speech, a fresh full hangover is needed to end the turn.
    const seq = [SPEECH, SPEECH, ...Array(5).fill(SILENCE), SPEECH, ...Array(7).fill(SILENCE)]
    const { events, state } = drive(seq)
    expect(events).toEqual(['speech-start'])
    expect(state.speaking).toBe(true) // 700ms of trailing silence < 800ms
  })
})
