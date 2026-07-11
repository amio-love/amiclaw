import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * PR-1 backward-compat proof for the co_build `action` frame.
 *
 * The shared hook grew ONE explicit branch: an `action` frame is handed to the
 * optional `onAction` callback and then RETURNS — it never reaches `voiceReducer`.
 * This proves the single handling path:
 *   - with NO `onAction` (every existing game): the frame is a pure no-op — ZERO
 *     reducer dispatches (exposed-state reference unchanged) and no throw;
 *   - with `onAction`: the callback receives `frame.actions`, and STILL nothing is
 *     dispatched to `voiceReducer`.
 *
 * `voiceReducer` is wrapped with a call-recording spy so "never enters the reducer"
 * is asserted directly, not merely inferred from unchanged state. It also covers:
 *   - barge-in transactional semantics: an action frame from a turn the player
 *     barged in on is dropped (shares the abandoned turn's fate);
 *   - turn-termination is a text-only event (audio never closes a turn).
 */

const reducerLog = vi.hoisted(() => ({ actions: [] as Array<{ type: string; frame?: unknown }> }))

vi.mock('./voice-session-protocol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./voice-session-protocol')>()
  return {
    ...actual,
    voiceReducer: (
      state: import('./voice-session-protocol').VoiceSessionState,
      action: import('./voice-session-protocol').VoiceAction
    ) => {
      reducerLog.actions.push(action as { type: string; frame?: unknown })
      return actual.voiceReducer(state, action)
    },
  }
})

// Controllable audio doubles so the barge-in path is drivable without a real
// AudioContext / mic: a test flips playback "playing" and invokes the captured VAD
// `onSpeechStart` to trigger a barge-in (which sets the hook's suppress flag).
const audioCtl = vi.hoisted(() => ({
  playing: false,
  onSpeechStart: null as null | (() => void),
}))

vi.mock('./audio-playback', () => ({
  createPcmPlayback: () => ({
    play: () => {},
    interrupt: () => {},
    teardown: () => {},
    isPlaying: () => audioCtl.playing,
  }),
}))

vi.mock('./audio-capture', () => ({
  createPcmCapture: () => ({
    start: (opts: { onSpeechStart: () => void }) => {
      audioCtl.onSpeechStart = opts.onSpeechStart
    },
    stop: () => {},
  }),
}))

import { useGameVoiceSession } from './use-game-voice-session'
import { initialVoiceState, voiceReducer } from './voice-session-protocol'
import type { ServerFrame } from './voice-session-protocol'

// --- Minimal WebSocket double: the hook connects on mount, then we hand it the
// `action` frame directly. We never fire `created`, so the mic / AudioContext
// path is never touched. ---
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason?: string }) => void) | null = null
  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }
  send(): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1000 })
  }
  deliver(frame: ServerFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

const manualData = { version: 'v1', sections: {} }
const gameState = { relevantSections: [] as string[] }
const ACTIONS = [{ op: 'place' as const, pieceType: 'kick', slot: 1 }]
const actionFrame: ServerFrame = { type: 'action', actions: ACTIONS }

/** How many reducer dispatches carried a `frame` action of the given wire type. */
function frameDispatchCount(frameType: string): number {
  return reducerLog.actions.filter(
    (a) => a.type === 'frame' && (a.frame as { type?: string } | undefined)?.type === frameType
  ).length
}

beforeEach(() => {
  reducerLog.actions = []
  MockWebSocket.instances = []
  audioCtl.playing = false
  audioCtl.onSpeechStart = null
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useGameVoiceSession — co_build action frame (PR-1 compat proof)', () => {
  it('with NO onAction: an action frame dispatches ZERO reducer actions and does not throw', () => {
    const { result } = renderHook(() =>
      useGameVoiceSession({ manualData, gameState, gameId: 'bombsquad' })
    )
    const ws = MockWebSocket.instances[0]
    expect(ws).toBeDefined()

    const dispatchesBefore = reducerLog.actions.length
    const stateBefore = result.current

    expect(() => act(() => ws.deliver(actionFrame))).not.toThrow()

    // Nothing was dispatched to the reducer for the action frame.
    expect(reducerLog.actions.length).toBe(dispatchesBefore)
    expect(frameDispatchCount('action')).toBe(0)
    // Exposed-state reference is unchanged (no re-render from the reducer).
    expect(result.current).toBe(stateBefore)
    expect(result.current.status).toBe(stateBefore.status)
  })

  it('with onAction: the callback receives frame.actions and STILL nothing is dispatched to voiceReducer', () => {
    const onAction = vi.fn()
    renderHook(() =>
      useGameVoiceSession({ manualData, gameState, gameId: 'sound-garden', onAction })
    )
    const ws = MockWebSocket.instances[0]
    expect(ws).toBeDefined()

    const dispatchesBefore = reducerLog.actions.length

    act(() => ws.deliver(actionFrame))

    // The callback got exactly the frame's actions.
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith(ACTIONS)
    // And the action frame never entered the reducer.
    expect(reducerLog.actions.length).toBe(dispatchesBefore)
    expect(frameDispatchCount('action')).toBe(0)
  })

  it('a non-action frame still routes through the reducer (the branch is action-only)', () => {
    const onAction = vi.fn()
    renderHook(() =>
      useGameVoiceSession({ manualData, gameState, gameId: 'sound-garden', onAction })
    )
    const ws = MockWebSocket.instances[0]

    // A `transcript` frame dispatches through the reducer as normal (no audio path).
    act(() => ws.deliver({ type: 'transcript', text: 'hi', final: false }))

    expect(frameDispatchCount('transcript')).toBe(1)
    expect(onAction).not.toHaveBeenCalled()
  })
})

describe('useGameVoiceSession — barge-in transactional semantics', () => {
  it('drops the action frame of a turn the player barged in on, then resumes on the next turn', () => {
    const onAction = vi.fn()
    renderHook(() =>
      useGameVoiceSession({ manualData, gameState, gameId: 'sound-garden', onAction })
    )
    const ws = MockWebSocket.instances[0]

    // Session live; a reply begins streaming (text chunk, not yet done).
    act(() => ws.deliver({ type: 'created', sessionId: 's1' }))
    act(() => ws.deliver({ type: 'chunk', kind: 'text', text: 'placing', done: false }))

    // The player barges in over the AI's audio → this turn is abandoned.
    audioCtl.playing = true
    act(() => audioCtl.onSpeechStart?.())

    // Ordering: partial playback → action → done, under barge-in ⇒ NO onAction call.
    act(() => ws.deliver({ type: 'action', actions: ACTIONS }))
    expect(onAction).not.toHaveBeenCalled()

    // The abandoned turn's terminal `done` clears the suppression; the NEXT turn's
    // action delivers normally (the drop is turn-scoped, not permanent).
    act(() => ws.deliver({ type: 'chunk', kind: 'text', text: '', done: true }))
    act(() => ws.deliver({ type: 'action', actions: ACTIONS }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith(ACTIONS)
  })
})

describe('turn termination is a text-only event', () => {
  it('an audio chunk never closes a turn; the terminal text chunk does', () => {
    // Wire-realistic frames: audio is pinned `done: false`; only text carries
    // `done: true`, so only the terminal text chunk flips `turnDone`.
    let s = voiceReducer(initialVoiceState, { type: 'connecting' })
    s = voiceReducer(s, { type: 'frame', frame: { type: 'created', sessionId: 's1' } })
    s = voiceReducer(s, {
      type: 'frame',
      frame: { type: 'chunk', kind: 'text', text: 'hi', done: false },
    })
    s = voiceReducer(s, {
      type: 'frame',
      frame: { type: 'chunk', kind: 'audio', audio: 'AAAA', done: false },
    })
    expect(s.turnDone).toBe(false)
    s = voiceReducer(s, {
      type: 'frame',
      frame: { type: 'chunk', kind: 'text', text: '', done: true },
    })
    expect(s.turnDone).toBe(true)
  })

  it('the ServerFrame type forbids an audio frame that closes a turn', () => {
    // @ts-expect-error audio chunks are pinned done:false — only text can end a turn.
    const bad: ServerFrame = { type: 'chunk', kind: 'audio', audio: 'x', done: true }
    void bad
  })
})
