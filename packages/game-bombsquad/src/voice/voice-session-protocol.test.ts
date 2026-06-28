import { describe, it, expect } from 'vitest'
import type { SessionSummary } from '@amiclaw/platform-ai/contract'
import {
  boundError,
  buildSessionUrl,
  initialVoiceState,
  voiceReducer,
  type ServerFrame,
  type VoiceSessionState,
} from './voice-session-protocol'

function summary(): SessionSummary {
  return {
    sessionId: 's1',
    gameId: 'bombsquad',
    userId: 'u1',
    turnCount: 2,
    usage: { llmInputTokens: 0, llmOutputTokens: 0, sttInputSeconds: 0, ttsOutputSeconds: 0 },
  }
}

/** Drive the reducer from `initialVoiceState` through a sequence of actions. */
function run(...actions: Parameters<typeof voiceReducer>[1][]): VoiceSessionState {
  return actions.reduce(voiceReducer, initialVoiceState)
}

describe('buildSessionUrl', () => {
  it('uses wss on https', () => {
    expect(buildSessionUrl({ protocol: 'https:', host: 'claw.amio.fans' }, 'abc')).toBe(
      'wss://claw.amio.fans/ai-ws/abc'
    )
  })

  it('uses ws on http (and preserves host:port)', () => {
    expect(buildSessionUrl({ protocol: 'http:', host: 'localhost:5173' }, 'xyz')).toBe(
      'ws://localhost:5173/ai-ws/xyz'
    )
  })
})

describe('boundError', () => {
  it('passes short messages through unchanged', () => {
    expect(boundError('nope')).toBe('nope')
  })

  it('caps very long messages', () => {
    const out = boundError('x'.repeat(500))
    expect(out.length).toBe(200)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('voiceReducer', () => {
  it('connecting resets to a fresh connecting state', () => {
    const dirty = run({ type: 'frame', frame: { type: 'created', sessionId: 's1' } })
    const next = voiceReducer({ ...dirty, aiText: 'stale', error: 'old' }, { type: 'connecting' })
    expect(next).toEqual({ ...initialVoiceState, status: 'connecting' })
  })

  it('created moves connecting -> ready and stores the sessionId', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 'sess-7' } }
    )
    expect(next.status).toBe('ready')
    expect(next.sessionId).toBe('sess-7')
  })

  it('talk-start moves ready -> in-turn and clears prior text/error', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'old reply', done: true } },
      { type: 'talk-start' }
    )
    expect(next.status).toBe('in-turn')
    expect(next.aiText).toBe('')
  })

  it('talk-start is a no-op when not ready (no double-turn from in-turn)', () => {
    const inTurn = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'talk-start' }
    )
    expect(inTurn.status).toBe('in-turn')
    expect(voiceReducer(inTurn, { type: 'talk-start' })).toBe(inTurn)
  })

  it('accumulates streamed text chunks across a turn', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'talk-start' },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'Hold ', done: false } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'the ', done: false } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'button.', done: false } }
    )
    expect(next.aiText).toBe('Hold the button.')
    expect(next.status).toBe('in-turn')
  })

  it('audio chunks do not change aiText but their done flag closes the turn', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'talk-start' },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'ok', done: false } },
      { type: 'frame', frame: { type: 'chunk', kind: 'audio', audio: 'AAAA', done: true } }
    )
    expect(next.aiText).toBe('ok')
    expect(next.status).toBe('ready')
  })

  it('a done text chunk returns the turn to ready', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'talk-start' },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'done now', done: true } }
    )
    expect(next.status).toBe('ready')
    expect(next.aiText).toBe('done now')
  })

  it('summary moves to closed and exposes the summary', () => {
    const s = summary()
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'summary', summary: s } }
    )
    expect(next.status).toBe('closed')
    expect(next.summary).toBe(s)
  })

  it('an in-band error frame surfaces a bounded message without changing status', () => {
    const ready = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } }
    )
    const next = voiceReducer(ready, {
      type: 'frame',
      frame: { type: 'error', code: 'turn_in_flight', message: 'a turn is already in progress' },
    })
    expect(next.status).toBe('ready')
    expect(next.error).toBe('a turn is already in progress')
  })

  it('mic-error surfaces a bounded message but keeps the session usable', () => {
    const ready = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } }
    )
    const next = voiceReducer(ready, { type: 'mic-error', message: 'microphone permission denied' })
    expect(next.status).toBe('ready')
    expect(next.error).toBe('microphone permission denied')
  })

  it('transport-error moves to error with a bounded message', () => {
    const next = voiceReducer(run({ type: 'connecting' }), {
      type: 'transport-error',
      message: 'voice connection closed (1006)',
    })
    expect(next.status).toBe('error')
    expect(next.error).toBe('voice connection closed (1006)')
  })

  it('closed lands a clean closed state', () => {
    const ready = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } }
    )
    expect(voiceReducer(ready, { type: 'closed' }).status).toBe('closed')
  })

  it('ignores unknown frame types (forward-compatible)', () => {
    const ready = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } }
    )
    const next = voiceReducer(ready, {
      type: 'frame',
      frame: { type: 'mystery' } as unknown as ServerFrame,
    })
    expect(next).toEqual(ready)
  })
})
