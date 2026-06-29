import { describe, it, expect } from 'vitest'
import type { SessionSummary } from '@amiclaw/platform-ai/contract'
import {
  boundError,
  buildSessionUrl,
  deriveConversationPhase,
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

  it('keeps status ready for the whole live session (no in-turn flips)', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'Hold ', done: false } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'on.', done: true } }
    )
    expect(next.status).toBe('ready')
  })

  it('accumulates streamed text chunks within one turn', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'Hold ', done: false } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'the ', done: false } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'button.', done: false } }
    )
    expect(next.aiText).toBe('Hold the button.')
  })

  it('resets aiText when the next turn begins (first chunk after a done)', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'first reply', done: true } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'second ', done: false } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'reply', done: false } }
    )
    // The done of turn 1 closes it; turn 2's first chunk starts fresh.
    expect(next.aiText).toBe('second reply')
  })

  it('stores the player transcript without disturbing aiText, turn boundary, or status', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'prior reply', done: true } },
      { type: 'frame', frame: { type: 'transcript', text: '红色还是蓝色的线' } }
    )
    expect(next.playerTranscript).toBe('红色还是蓝色的线')
    // The AI's previous reply text, turn boundary, and status are untouched.
    expect(next.aiText).toBe('prior reply')
    expect(next.turnDone).toBe(true)
    expect(next.status).toBe('ready')
  })

  it('keeps the latest transcript across turns (most recent utterance wins)', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'transcript', text: 'first utterance' } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'reply one', done: true } },
      { type: 'frame', frame: { type: 'transcript', text: 'second utterance' } }
    )
    expect(next.playerTranscript).toBe('second utterance')
  })

  it('builds the live subtitle up across interim transcript frames (cumulative text)', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'transcript', text: '红', final: false } },
      { type: 'frame', frame: { type: 'transcript', text: '红色', final: false } },
      { type: 'frame', frame: { type: 'transcript', text: '红色的线', final: false } }
    )
    expect(next.playerTranscript).toBe('红色的线')
  })

  it('settles the full utterance on the final transcript frame', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'transcript', text: '红色', final: false } },
      { type: 'frame', frame: { type: 'transcript', text: '红色的线', final: true } }
    )
    expect(next.playerTranscript).toBe('红色的线')
  })

  it("replaces the prior subtitle on the next utterance's first interim (no append across utterances)", () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'transcript', text: '第一句话', final: true } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'reply', done: true } },
      { type: 'frame', frame: { type: 'transcript', text: '第', final: false } }
    )
    // The next utterance's first interim ('第') replaces the prior final — never appends.
    expect(next.playerTranscript).toBe('第')
  })

  it('treats a transcript with no `final` flag as a non-terminal interim (stores the latest text)', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'transcript', text: 'no final flag here' } }
    )
    expect(next.playerTranscript).toBe('no final flag here')
  })

  it('audio chunks do not change aiText but their done flag closes the turn', () => {
    const next = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      { type: 'frame', frame: { type: 'chunk', kind: 'text', text: 'ok', done: false } },
      { type: 'frame', frame: { type: 'chunk', kind: 'audio', audio: 'AAAA', done: true } }
    )
    expect(next.aiText).toBe('ok')
    expect(next.turnDone).toBe(true)
  })

  it('barge-in clears the interrupted turn text and closes the turn boundary', () => {
    const interrupted = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } },
      {
        type: 'frame',
        frame: { type: 'chunk', kind: 'text', text: 'long answer so f', done: false },
      },
      { type: 'barge-in' }
    )
    expect(interrupted.aiText).toBe('')
    expect(interrupted.turnDone).toBe(true)
    expect(interrupted.status).toBe('ready')

    // The AI's NEXT turn (answer to the interruption) renders fresh.
    const answered = voiceReducer(interrupted, {
      type: 'frame',
      frame: { type: 'chunk', kind: 'text', text: 'new answer', done: false },
    })
    expect(answered.aiText).toBe('new answer')
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

  it('an unexpected in-band error frame surfaces a bounded message without changing status', () => {
    const ready = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } }
    )
    const next = voiceReducer(ready, {
      type: 'frame',
      frame: { type: 'error', code: 'provider_unavailable', message: 'speech provider down' },
    })
    expect(next.status).toBe('ready')
    expect(next.error).toBe('speech provider down')
  })

  it('drops benign in-band rejections (turn_in_flight / already_created) with no visible error', () => {
    const ready = run(
      { type: 'connecting' },
      { type: 'frame', frame: { type: 'created', sessionId: 's1' } }
    )
    for (const code of ['turn_in_flight', 'already_created'] as const) {
      const next = voiceReducer(ready, {
        type: 'frame',
        frame: { type: 'error', code, message: 'a turn is already in progress' },
      })
      expect(next.status).toBe('ready')
      expect(next.error).toBeNull()
    }
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

describe('deriveConversationPhase', () => {
  it('is speaking whenever the AI audio is playing (highest priority)', () => {
    expect(
      deriveConversationPhase({
        isAiSpeaking: true,
        playerSpeaking: false,
        awaitingResponse: false,
      })
    ).toBe('speaking')
    // AI audio wins even if the player just started talking over it (barge-in is
    // resolved by the hook stopping playback, which clears isAiSpeaking).
    expect(
      deriveConversationPhase({ isAiSpeaking: true, playerSpeaking: true, awaitingResponse: true })
    ).toBe('speaking')
  })

  it('is listening while the player is speaking (and the AI is not)', () => {
    expect(
      deriveConversationPhase({
        isAiSpeaking: false,
        playerSpeaking: true,
        awaitingResponse: false,
      })
    ).toBe('listening')
  })

  it('is thinking once the player stopped and the AI has not started', () => {
    expect(
      deriveConversationPhase({
        isAiSpeaking: false,
        playerSpeaking: false,
        awaitingResponse: true,
      })
    ).toBe('thinking')
  })

  it('is listening when idle (mic open, no one talking, nothing pending)', () => {
    expect(
      deriveConversationPhase({
        isAiSpeaking: false,
        playerSpeaking: false,
        awaitingResponse: false,
      })
    ).toBe('listening')
  })
})
