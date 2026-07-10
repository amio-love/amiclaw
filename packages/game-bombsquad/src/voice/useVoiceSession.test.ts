import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { GameState, ManualData, SessionSummary } from '@amiclaw/platform-ai/contract'
import { useVoiceSession } from './useVoiceSession'
import {
  GAME_VOICE_END_ACK_TIMEOUT_MS,
  SHADOW_CHASE_VOICE_GUARDS,
  useGameVoiceSession,
} from '@shared/voice/use-game-voice-session'

// --- Mocks: WebSocket / AudioContext / getUserMedia ---

type Listener = ((arg?: unknown) => void) | null

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  url: string
  readyState = 0
  closeCalls = 0
  sent: Array<string | ArrayBuffer> = []
  onopen: Listener = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: Listener = null
  onclose: ((event: { code: number; reason?: string }) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls += 1
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: '' })
  }

  // --- test drivers ---
  fireOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  fireMessage(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }

  fireError(): void {
    this.onerror?.()
  }

  fireClose(code: number, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }

  controlMessages(): Array<Record<string, unknown>> {
    return this.sent
      .filter((m): m is string => typeof m === 'string')
      .map((m) => JSON.parse(m) as Record<string, unknown>)
  }

  binaryFrameCount(): number {
    return this.sent.filter((m) => typeof m !== 'string').length
  }
}

class MockBufferSource {
  buffer: unknown = null
  onended: Listener = null
  started = false
  stopped = false
  connect(): void {}
  disconnect(): void {}
  start(): void {
    this.started = true
  }
  stop(): void {
    this.stopped = true
  }
}

class MockScriptProcessor {
  onaudioprocess: ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null =
    null
  connect(): void {}
  disconnect(): void {}
}

class MockAudioContext {
  static instances: MockAudioContext[] = []
  currentTime = 0
  destination = {}
  sampleRate: number
  processor: MockScriptProcessor | null = null
  sources: MockBufferSource[] = []

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 48000
    MockAudioContext.instances.push(this)
  }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
  createBuffer(_ch: number, len: number, rate: number) {
    return { duration: len / rate, getChannelData: () => new Float32Array(len) }
  }
  createBufferSource(): MockBufferSource {
    const s = new MockBufferSource()
    this.sources.push(s)
    return s
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} }
  }
  createScriptProcessor(): MockScriptProcessor {
    const p = new MockScriptProcessor()
    this.processor = p
    return p
  }
}

const getUserMedia = vi.fn(async () => ({
  getTracks: () => [{ stop() {} }],
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function manualData(): ManualData {
  return { version: 'v1', sections: { button: { rule: 'hold it' } } }
}
function gameState(): GameState {
  return { relevantSections: ['button'] }
}
function summary(): SessionSummary {
  return {
    sessionId: 's1',
    gameId: 'bombsquad',
    userId: 'u1',
    turnCount: 1,
    usage: { llmInputTokens: 0, llmOutputTokens: 0, sttInputSeconds: 0, ttsOutputSeconds: 0 },
  }
}

// The capture context is the only one that creates a ScriptProcessor.
function captureProcessor(): MockScriptProcessor {
  const ctx = MockAudioContext.instances.find((c) => c.processor)
  if (!ctx?.processor) throw new Error('no capture processor yet')
  return ctx.processor
}

// The playback context has buffer sources and no processor.
function playbackSources(): MockBufferSource[] {
  const ctx = MockAudioContext.instances.find((c) => !c.processor && c.sources.length > 0)
  return ctx?.sources ?? []
}

const SAMPLES = 4096 // matches CAPTURE_BUFFER_SIZE; at 16 kHz that is 256ms/frame.

/** Fire one capture frame of the given constant amplitude through the VAD path. */
function fireFrame(amplitude: number): void {
  const data = new Float32Array(SAMPLES).fill(amplitude)
  captureProcessor().onaudioprocess?.({ inputBuffer: { getChannelData: () => data } })
}

const audioB64 = btoa(String.fromCharCode(0, 0, 1, 0)) // 2 PCM16 samples

beforeEach(() => {
  MockWebSocket.instances = []
  MockAudioContext.instances = []
  getUserMedia.mockClear()
  getUserMedia.mockImplementation(async () => ({ getTracks: () => [{ stop() {} }] }))
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('AudioContext', MockAudioContext)
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function lastSocket(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1)
  if (!ws) throw new Error('no WebSocket constructed')
  return ws
}

/** Bring a hook to a live session with the mic streaming. */
async function ready() {
  const rendered = renderHook(() =>
    useVoiceSession({ gameRunId: 'run-voice', manualData: manualData(), gameState: gameState() })
  )
  const ws = lastSocket()
  act(() => ws.fireOpen())
  await act(async () => {
    ws.fireMessage({ type: 'created', sessionId: 'sess-1' })
  })
  await waitFor(() => captureProcessor())
  return { ...rendered, ws }
}

describe('useVoiceSession — connection', () => {
  it('stays idle until a manual is provided', () => {
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: null, gameState: gameState() })
    )
    expect(result.current.status).toBe('idle')
    expect(MockWebSocket.instances.length).toBe(0)
  })

  it('connects same-origin and sends create with no userId/prompt', () => {
    const { result } = renderHook(() =>
      useVoiceSession({ gameRunId: 'run-voice', manualData: manualData(), gameState: gameState() })
    )
    expect(result.current.status).toBe('connecting')
    const ws = lastSocket()
    expect(ws.url).toMatch(/^ws:\/\/[^/]+\/ai-ws\/bombsquad-/)

    act(() => ws.fireOpen())
    const create = ws.controlMessages()[0]
    expect(create).toMatchObject({
      type: 'create',
      gameId: 'bombsquad',
      gameRunId: 'run-voice',
      manualData: { version: 'v1' },
      gameState: { relevantSections: ['button'] },
    })
    expect(create).not.toHaveProperty('userId')
    expect(create).not.toHaveProperty('systemPrompt')
  })

  it('an unexpected socket close becomes a bounded transport error', () => {
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => ws.fireMessage({ type: 'created', sessionId: 'sess-1' }))
    act(() => ws.fireClose(1006))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('1006')
  })

  it('surfaces the server close reason alongside the code on a 1008', () => {
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => ws.fireMessage({ type: 'created', sessionId: 'sess-1' }))
    act(() => ws.fireClose(1008, 'asr driver failed'))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('1008')
    expect(result.current.error).toContain('asr driver failed')
  })

  it('closes the socket on unmount (lifecycle hygiene)', () => {
    const { unmount } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    expect(ws.readyState).toBe(MockWebSocket.OPEN)
    unmount()
    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
  })
})

describe('useVoiceSession — hands-free lifecycle', () => {
  it('reaches ready and auto-opens the mic on created (no push-to-talk)', async () => {
    const { result, ws } = await ready()
    expect(result.current.status).toBe('ready')
    expect(getUserMedia).toHaveBeenCalledOnce()
    // No startTalking / stopTalking on the surface anymore.
    expect(result.current).not.toHaveProperty('startTalking')
    expect(result.current).not.toHaveProperty('stopTalking')
    // Mic is streaming: a capture frame produces a binary WS frame.
    act(() => fireFrame(0.0))
    expect(ws.binaryFrameCount()).toBeGreaterThan(0)
  })

  it('renders the AI-first opening turn with no player input (thinking -> speaking)', async () => {
    const { result, ws } = await ready()
    // Opening greeting pending, AI not yet audible -> thinking.
    expect(result.current.conversationPhase).toBe('thinking')

    act(() => {
      ws.fireMessage({ type: 'chunk', kind: 'text', text: 'Hi ', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'text', text: 'there.', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true })
    })
    expect(result.current.aiText).toBe('Hi there.')
    expect(result.current.isAiSpeaking).toBe(true)
    expect(result.current.conversationPhase).toBe('speaking')
  })

  it('exposes the player transcript from a transcript frame (before the AI reply)', async () => {
    const { result, ws } = await ready()
    expect(result.current.playerTranscript).toBe('')

    // The server sends the player's recognized utterance before the reply chunks.
    act(() => ws.fireMessage({ type: 'transcript', text: '剪红色的线吗' }))
    expect(result.current.playerTranscript).toBe('剪红色的线吗')

    // The AI reply streams independently and does not clobber the transcript.
    act(() => ws.fireMessage({ type: 'chunk', kind: 'text', text: '先别剪', done: true }))
    expect(result.current.aiText).toBe('先别剪')
    expect(result.current.playerTranscript).toBe('剪红色的线吗')
  })

  it('clears the speaking state when the last buffer ends', async () => {
    const { result, ws } = await ready()
    act(() => ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true }))
    expect(result.current.isAiSpeaking).toBe(true)
    act(() => playbackSources().at(-1)?.onended?.())
    expect(result.current.isAiSpeaking).toBe(false)
  })

  it('surfaces a bounded mic error and stays ready when permission is denied', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('denied'))
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    await act(async () => {
      ws.fireMessage({ type: 'created', sessionId: 'sess-1' })
    })
    await waitFor(() => expect(result.current.error).toBe('microphone permission denied'))
    expect(result.current.status).toBe('ready')
  })

  it('endSession sends end and lands closed with the summary', async () => {
    const { result, ws } = await ready()
    act(() => result.current.endSession())
    expect(ws.controlMessages().some((m) => m.type === 'end')).toBe(true)

    const s = summary()
    act(() => ws.fireMessage({ type: 'summary', summary: s }))
    act(() => ws.fireClose(1000))
    expect(result.current.status).toBe('closed')
    expect(result.current.summary).toMatchObject({ turnCount: 1 })
  })

  it('endSession sends end exactly once even when called twice (no double capture)', async () => {
    const { result, ws } = await ready()
    act(() => result.current.endSession())
    act(() => result.current.endSession())
    expect(ws.controlMessages().filter((m) => m.type === 'end')).toHaveLength(1)
  })

  it('closes after the bounded end-ack timeout when the server never acknowledges', () => {
    vi.useFakeTimers()
    expect(GAME_VOICE_END_ACK_TIMEOUT_MS).toBe(5_000)
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())

    act(() => result.current.endSession())
    act(() => vi.advanceTimersByTime(GAME_VOICE_END_ACK_TIMEOUT_MS - 1))
    expect(ws.readyState).toBe(MockWebSocket.OPEN)
    act(() => vi.advanceTimersByTime(1))
    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
    expect(ws.closeCalls).toBe(1)
    expect(result.current.status).toBe('closed')
  })

  it('a summary clears the end-ack timer and duplicate terminal effects stay idempotent', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())

    act(() => result.current.endSession())
    act(() => result.current.endSession())
    act(() => ws.fireMessage({ type: 'summary', summary: summary() }))
    expect(ws.controlMessages().filter((m) => m.type === 'end')).toHaveLength(1)
    expect(ws.closeCalls).toBe(1)
    expect(result.current.summary).toMatchObject({ turnCount: 1 })

    act(() => vi.advanceTimersByTime(GAME_VOICE_END_ACK_TIMEOUT_MS))
    act(() => result.current.endSession())
    expect(ws.controlMessages().filter((m) => m.type === 'end')).toHaveLength(1)
    expect(ws.closeCalls).toBe(1)
    unmount()
    expect(ws.closeCalls).toBe(1)
  })

  it('unmount clears the end-ack timer after one terminal send', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => result.current.endSession())

    unmount()
    expect(ws.controlMessages().filter((m) => m.type === 'end')).toHaveLength(1)
    expect(ws.closeCalls).toBe(1)
    act(() => vi.advanceTimersByTime(GAME_VOICE_END_ACK_TIMEOUT_MS))
    expect(ws.closeCalls).toBe(1)
  })

  it('an explicit close clears the pending end-ack timer', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useGameVoiceSession({
        manualData: manualData(),
        gameState: gameState(),
        autoConnect: false,
      })
    )
    act(() => result.current.openSession())
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => result.current.endSession())
    act(() => result.current.closeSession())

    expect(ws.closeCalls).toBe(1)
    act(() => vi.advanceTimersByTime(GAME_VOICE_END_ACK_TIMEOUT_MS))
    expect(ws.closeCalls).toBe(1)
    expect(result.current.status).toBe('closed')
  })

  it('a terminal socket close clears the pending end-ack timer', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => result.current.endSession())
    act(() => ws.fireClose(1000))

    expect(result.current.status).toBe('closed')
    act(() => vi.advanceTimersByTime(GAME_VOICE_END_ACK_TIMEOUT_MS))
    expect(ws.closeCalls).toBe(0)
  })

  it('settlement end then unmount sends end once — the unmount close does not resend', async () => {
    const { result, ws, unmount } = await ready()
    act(() => result.current.endSession())
    unmount()
    expect(ws.controlMessages().filter((m) => m.type === 'end')).toHaveLength(1)
  })

  it('an abrupt unmount with no settlement sends NO end (crash / exit fallback)', async () => {
    const { ws, unmount } = await ready()
    unmount()
    expect(ws.controlMessages().some((m) => m.type === 'end')).toBe(false)
    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
  })
})

/**
 * Finish the AI-first opening greeting so the AI is idle (awaiting cleared,
 * playback ended): one done audio chunk, then its source's `onended`. After this
 * the hook will accept a player turn on the next utterance-end.
 */
function finishGreeting(ws: MockWebSocket): void {
  act(() => ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true }))
  act(() => playbackSources().at(-1)?.onended?.())
}

describe('useVoiceSession — client VAD', () => {
  it('sends a turn on utterance-end once the AI is idle', async () => {
    const { result, ws } = await ready()
    finishGreeting(ws)
    expect(result.current.isAiSpeaking).toBe(false)

    // Two 256ms speech frames (>= 400ms minSpeechMs) start the utterance.
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    expect(result.current.playerSpeaking).toBe(true)
    expect(result.current.conversationPhase).toBe('listening')

    // Ten 256ms silence frames (2560ms >= 2500ms hangover) end it -> a turn is sent.
    act(() => {
      for (let i = 0; i < 10; i += 1) fireFrame(0.0)
    })
    expect(result.current.playerSpeaking).toBe(false)
    expect(result.current.conversationPhase).toBe('thinking')
    expect(ws.controlMessages().some((m) => m.type === 'turn')).toBe(true)
  })

  it('stays thinking when noise crosses the VAD threshold while awaiting the reply', async () => {
    const { result, ws } = await ready()
    finishGreeting(ws)
    // A real player utterance: speech then silence -> turn sent -> thinking.
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    act(() => {
      for (let i = 0; i < 10; i += 1) fireFrame(0.0)
    })
    expect(result.current.conversationPhase).toBe('thinking')
    const speechStartsBefore = ws.controlMessages().filter((m) => m.type === 'speech-start').length

    // Still awaiting the reply (no chunk yet). The open mic picks up a breath /
    // room-noise tail crossing the threshold for >= minSpeechMs. This must NOT
    // yank the indicator from `thinking` back to `listening`, nor open a spurious
    // server utterance — the AI still holds the floor.
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    expect(result.current.playerSpeaking).toBe(false)
    expect(result.current.conversationPhase).toBe('thinking')
    expect(ws.controlMessages().filter((m) => m.type === 'speech-start').length).toBe(
      speechStartsBefore
    )
  })

  it('sends speech-start then turn, in order, for a real player utterance', async () => {
    const { ws } = await ready()
    finishGreeting(ws)

    // Two 256ms speech frames (>= 400ms minSpeechMs) start the utterance.
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    // The utterance START is signaled once; the turn waits for utterance-end.
    expect(ws.controlMessages().filter((m) => m.type === 'speech-start')).toHaveLength(1)
    expect(ws.controlMessages().some((m) => m.type === 'turn')).toBe(false)

    // Ten 256ms silence frames (2560ms >= 2500ms hangover) end it -> the turn.
    act(() => {
      for (let i = 0; i < 10; i += 1) fireFrame(0.0)
    })
    const types = ws.controlMessages().map((m) => m.type)
    // Exactly one speech-start, exactly one turn, speech-start BEFORE the turn.
    expect(types.filter((t) => t === 'speech-start')).toHaveLength(1)
    expect(types.filter((t) => t === 'turn')).toHaveLength(1)
    expect(types.indexOf('turn')).toBeGreaterThan(types.indexOf('speech-start'))
  })

  it('does not send speech-start while the AI-first opening greeting is in flight', async () => {
    const { ws } = await ready()
    // No greeting chunk yet: the hook is awaiting the opening reply. Noise the open
    // mic picks up (the greeting's own voice / the stopwatch tick) must NOT open an
    // utterance on the server — that would race the in-flight greeting.
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
      fireFrame(0.0)
      fireFrame(0.0)
    })
    expect(ws.controlMessages().some((m) => m.type === 'speech-start')).toBe(false)
  })

  it('does not send speech-start while a (non-barged-in) AI turn is still streaming', async () => {
    const { ws } = await ready()
    finishGreeting(ws)
    // A reply turn is streaming text (done:false) with no audio playing yet — the
    // AI holds the floor, and this is NOT a barge-in.
    act(() => ws.fireMessage({ type: 'chunk', kind: 'text', text: 'still talking', done: false }))
    const before = ws.controlMessages().filter((m) => m.type === 'speech-start').length
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    expect(ws.controlMessages().filter((m) => m.type === 'speech-start').length).toBe(before)
  })

  it('does not send a turn while the AI-first opening greeting is in flight', async () => {
    const { result, ws } = await ready()
    // No greeting chunk yet: the hook is awaiting the opening reply. Noise the
    // open mic picks up (the greeting's own voice / the stopwatch tick) must NOT
    // be handed to the server as a turn — that races the in-flight greeting and
    // earns a `turn_in_flight` rejection.
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
      fireFrame(0.0)
      fireFrame(0.0)
      fireFrame(0.0)
      fireFrame(0.0)
    })
    expect(ws.controlMessages().some((m) => m.type === 'turn')).toBe(false)
    expect(result.current.status).toBe('ready')
  })

  it('does not fire a turn on background noise below the threshold', async () => {
    const { result, ws } = await ready()
    act(() => {
      for (let i = 0; i < 10; i += 1) fireFrame(0.005)
    })
    expect(result.current.playerSpeaking).toBe(false)
    expect(ws.controlMessages().some((m) => m.type === 'turn')).toBe(false)
  })

  it('treats a turn_in_flight server error as a benign no-op (no visible error)', async () => {
    const { result, ws } = await ready()
    act(() =>
      ws.fireMessage({
        type: 'error',
        code: 'turn_in_flight',
        message: 'a turn is already in progress',
      })
    )
    expect(result.current.error).toBeNull()
    expect(result.current.status).toBe('ready')
  })
})

describe('useVoiceSession — module advance steers one session', () => {
  /** Render with a controllable gameState prop, then bring it to a live session. */
  async function readyWithGameState(initial: GameState) {
    const rendered = renderHook(
      ({ gs }: { gs: GameState }) => useVoiceSession({ manualData: manualData(), gameState: gs }),
      { initialProps: { gs: initial } }
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    await act(async () => {
      ws.fireMessage({ type: 'created', sessionId: 'sess-1' })
    })
    await waitFor(() => captureProcessor())
    return { ...rendered, ws }
  }

  it('sends the first module via create and never an update for it', async () => {
    const { ws } = await readyWithGameState({ relevantSections: ['wire_routing'] })
    const create = ws.controlMessages().find((m) => m.type === 'create')
    expect(create).toMatchObject({ gameState: { relevantSections: ['wire_routing'] } })
    expect(ws.controlMessages().some((m) => m.type === 'update-gamestate')).toBe(false)
  })

  it('advancing a module sends ONE update-gamestate on the SAME socket (no reconnect/re-greet)', async () => {
    const { ws, rerender } = await readyWithGameState({ relevantSections: ['wire_routing'] })
    const socketsBefore = MockWebSocket.instances.length

    // Player advances to the next module: relevantSections change.
    act(() => rerender({ gs: { relevantSections: ['symbol_dial'] } }))

    const updates = ws.controlMessages().filter((m) => m.type === 'update-gamestate')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      type: 'update-gamestate',
      gameState: { relevantSections: ['symbol_dial'] },
    })
    // Same live socket — no fresh WebSocket constructed (no reconnect), and no
    // second `create` (no re-greet).
    expect(MockWebSocket.instances.length).toBe(socketsBefore)
    expect(ws.controlMessages().filter((m) => m.type === 'create')).toHaveLength(1)
  })

  it('sends one update per module across several advances', async () => {
    const { ws, rerender } = await readyWithGameState({ relevantSections: ['wire_routing'] })
    act(() => rerender({ gs: { relevantSections: ['symbol_dial'] } }))
    act(() => rerender({ gs: { relevantSections: ['button'] } }))
    act(() => rerender({ gs: { relevantSections: ['keypad'] } }))
    const updates = ws.controlMessages().filter((m) => m.type === 'update-gamestate')
    expect(updates.map((m) => (m.gameState as GameState).relevantSections)).toEqual([
      ['symbol_dial'],
      ['button'],
      ['keypad'],
    ])
  })

  it('does not send an update when a re-render leaves the sections unchanged', async () => {
    const { ws, rerender } = await readyWithGameState({ relevantSections: ['wire_routing'] })
    // A new object with identical sections (e.g. a stopwatch-frame re-render).
    act(() => rerender({ gs: { relevantSections: ['wire_routing'] } }))
    expect(ws.controlMessages().some((m) => m.type === 'update-gamestate')).toBe(false)
  })

  it('does not send an update before the session is created', async () => {
    const rendered = renderHook(
      ({ gs }: { gs: GameState }) => useVoiceSession({ manualData: manualData(), gameState: gs }),
      { initialProps: { gs: { relevantSections: ['wire_routing'] } as GameState } }
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    // Section change while connecting (no `created` yet) — must not steer a
    // not-yet-existing session, and must not duplicate a `create`.
    act(() => rendered.rerender({ gs: { relevantSections: ['symbol_dial'] } }))
    expect(ws.controlMessages().some((m) => m.type === 'update-gamestate')).toBe(false)
    // Once created, the latest sections are reconciled with exactly one steer.
    await act(async () => {
      ws.fireMessage({ type: 'created', sessionId: 'sess-1' })
    })
    const updates = ws.controlMessages().filter((m) => m.type === 'update-gamestate')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ gameState: { relevantSections: ['symbol_dial'] } })
  })
})

describe('useVoiceSession — barge-in', () => {
  it('stops AI playback and drops the interrupted turn when the player talks over it', async () => {
    const { result, ws } = await ready()

    // AI is mid-response: text + audio streaming, not yet done.
    act(() => {
      ws.fireMessage({ type: 'chunk', kind: 'text', text: 'a long answer that goes', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: false })
    })
    expect(result.current.isAiSpeaking).toBe(true)
    const playing = playbackSources().at(-1)
    const speechStartsBefore = ws.controlMessages().filter((m) => m.type === 'speech-start').length

    // Player barges in (2 frames >= the 400ms minSpeechMs).
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    expect(playing?.stopped).toBe(true)
    expect(result.current.isAiSpeaking).toBe(false)
    expect(result.current.playerSpeaking).toBe(true)
    expect(result.current.aiText).toBe('') // interrupted turn's text dropped
    // A genuine barge-in IS a real utterance start: it stops playback AND signals
    // speech-start so the server transcribes the interrupting utterance live.
    expect(ws.controlMessages().filter((m) => m.type === 'speech-start').length).toBe(
      speechStartsBefore + 1
    )

    // The interrupted turn's tail keeps streaming from the server — drop it.
    act(() => ws.fireMessage({ type: 'chunk', kind: 'text', text: ' on and on', done: true }))
    expect(result.current.aiText).toBe('')

    // After the player goes silent and the next turn streams, it renders fresh.
    act(() => {
      fireFrame(0.0)
      fireFrame(0.0)
      fireFrame(0.0)
      fireFrame(0.0)
    })
    act(() => ws.fireMessage({ type: 'chunk', kind: 'text', text: 'new answer', done: false }))
    expect(result.current.aiText).toBe('new answer')
  })
})

describe('shared game voice session — Shadow Chase surface', () => {
  it('opens only on an explicit action, reuses a granted stream, and delivers one final transcript', async () => {
    const onFinalTranscript = vi.fn()
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    const rendered = renderHook(() =>
      useGameVoiceSession({
        gameId: 'shadow-chase',
        gameRunId: 'run-shadow',
        sessionNamePrefix: 'shadow-chase',
        manualData: { version: 'shadow-v1', sections: {} },
        gameState: { relevantSections: [], publicContext: { version: 1 } },
        autoConnect: false,
        opening: false,
        guards: SHADOW_CHASE_VOICE_GUARDS,
        onFinalTranscript,
      })
    )

    expect(MockWebSocket.instances).toHaveLength(0)
    act(() => rendered.result.current.openSession(stream))
    const ws = lastSocket()
    expect(ws.url).toMatch(/\/ai-ws\/shadow-chase-/)
    act(() => ws.fireOpen())
    expect(ws.controlMessages()[0]).toMatchObject({
      type: 'create',
      gameId: 'shadow-chase',
      gameRunId: 'run-shadow',
      opening: false,
    })
    await act(async () => ws.fireMessage({ type: 'created', sessionId: 'shadow-session' }))
    await waitFor(() => captureProcessor())
    expect(getUserMedia).not.toHaveBeenCalled()

    act(() => {
      ws.fireMessage({ type: 'transcript', text: '去诱敌', final: false })
      ws.fireMessage({ type: 'transcript', text: '去诱敌', final: true })
      ws.fireMessage({ type: 'transcript', text: '去诱敌', final: true })
    })
    expect(onFinalTranscript).toHaveBeenCalledOnce()
    expect(onFinalTranscript).toHaveBeenCalledWith({ sequence: 1, text: '去诱敌' })
  })

  it('freezes the Shadow voice guards and closes voice on connect timeout only', () => {
    vi.useFakeTimers()
    expect(SHADOW_CHASE_VOICE_GUARDS).toEqual({
      connectMs: 5_000,
      responseMs: 12_000,
      silenceMs: 30_000,
      maxPlayerTurns: 8,
      maxDurationMs: 180_000,
    })
    const { result } = renderHook(() =>
      useGameVoiceSession({
        gameId: 'shadow-chase',
        manualData: { version: 'shadow-v1', sections: {} },
        gameState: { relevantSections: [], publicContext: { version: 1 } },
        autoConnect: false,
        guards: SHADOW_CHASE_VOICE_GUARDS,
      })
    )
    act(() => result.current.openSession())
    act(() => vi.advanceTimersByTime(SHADOW_CHASE_VOICE_GUARDS.connectMs))
    expect(result.current.status).toBe('closed')
    expect(result.current.errorCode).toBe('connect-timeout')
    vi.useRealTimers()
  })

  it('reopens only by explicit gesture after close and keeps one socket and capture at a time', async () => {
    const firstTrack = { stop: vi.fn() }
    const secondTrack = { stop: vi.fn() }
    const duplicateTrack = { stop: vi.fn() }
    const stream = (track: { stop: () => void }) =>
      ({ getTracks: () => [track] }) as unknown as MediaStream
    const { result } = renderHook(() =>
      useGameVoiceSession({
        gameId: 'shadow-chase',
        manualData: { version: 'shadow-v1', sections: {} },
        gameState: { relevantSections: [], publicContext: { version: 1 } },
        autoConnect: false,
        opening: false,
      })
    )

    act(() => result.current.openSession(stream(firstTrack)))
    const firstSocket = lastSocket()
    act(() => firstSocket.fireOpen())
    await act(async () => firstSocket.fireMessage({ type: 'created', sessionId: 'first' }))
    expect(result.current.status).toBe('ready')
    expect(MockWebSocket.instances).toHaveLength(1)

    act(() => result.current.closeSession())
    expect(firstSocket.readyState).toBe(MockWebSocket.CLOSED)
    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('closed')

    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(MockWebSocket.instances).toHaveLength(1)

    act(() => result.current.openSession(stream(secondTrack)))
    const secondSocket = lastSocket()
    expect(secondSocket).not.toBe(firstSocket)
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(result.current.status).toBe('connecting')

    act(() => result.current.openSession(stream(duplicateTrack)))
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(duplicateTrack.stop).toHaveBeenCalledOnce()
    expect(secondTrack.stop).not.toHaveBeenCalled()

    act(() => secondSocket.fireOpen())
    await act(async () => secondSocket.fireMessage({ type: 'created', sessionId: 'second' }))
    expect(result.current.status).toBe('ready')
    expect(getUserMedia).not.toHaveBeenCalled()

    act(() => result.current.closeSession())
    expect(secondSocket.closeCalls).toBe(1)
    expect(secondTrack.stop).toHaveBeenCalledOnce()
  })

  it('a stale successful microphone attempt cannot unlock a reopened session capture', async () => {
    const firstAttempt = deferred<{ getTracks: () => Array<{ stop: () => void }> }>()
    const secondAttempt = deferred<{ getTracks: () => Array<{ stop: () => void }> }>()
    const staleTrack = { stop: vi.fn() }
    getUserMedia
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockImplementationOnce(() => secondAttempt.promise)
    const { result } = renderHook(() =>
      useGameVoiceSession({
        gameId: 'shadow-chase',
        manualData: { version: 'shadow-v1', sections: {} },
        gameState: { relevantSections: [], publicContext: { version: 1 } },
        autoConnect: false,
        opening: false,
      })
    )

    act(() => result.current.openSession())
    const firstSocket = lastSocket()
    act(() => firstSocket.fireOpen())
    act(() => firstSocket.fireMessage({ type: 'created', sessionId: 'first' }))
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    act(() => result.current.closeSession())
    act(() => result.current.openSession())
    const secondSocket = lastSocket()
    act(() => secondSocket.fireOpen())
    act(() => secondSocket.fireMessage({ type: 'created', sessionId: 'second' }))
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    await act(async () => {
      firstAttempt.resolve({ getTracks: () => [staleTrack] })
      await firstAttempt.promise
      await Promise.resolve()
    })
    expect(staleTrack.stop).toHaveBeenCalledOnce()

    act(() => secondSocket.fireMessage({ type: 'created', sessionId: 'duplicate' }))
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('a stale rejected microphone attempt cannot close the reopened session', async () => {
    const firstAttempt = deferred<{ getTracks: () => Array<{ stop: () => void }> }>()
    const secondAttempt = deferred<{ getTracks: () => Array<{ stop: () => void }> }>()
    getUserMedia
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockImplementationOnce(() => secondAttempt.promise)
    const { result } = renderHook(() =>
      useGameVoiceSession({
        gameId: 'shadow-chase',
        manualData: { version: 'shadow-v1', sections: {} },
        gameState: { relevantSections: [], publicContext: { version: 1 } },
        autoConnect: false,
        opening: false,
        guards: SHADOW_CHASE_VOICE_GUARDS,
      })
    )

    act(() => result.current.openSession())
    const firstSocket = lastSocket()
    act(() => firstSocket.fireOpen())
    act(() => firstSocket.fireMessage({ type: 'created', sessionId: 'first' }))
    act(() => result.current.closeSession())

    act(() => result.current.openSession())
    const secondSocket = lastSocket()
    act(() => secondSocket.fireOpen())
    act(() => secondSocket.fireMessage({ type: 'created', sessionId: 'second' }))
    expect(result.current.status).toBe('ready')
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    await act(async () => {
      firstAttempt.reject(new Error('stale permission denial'))
      await firstAttempt.promise.catch(() => undefined)
      await Promise.resolve()
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.errorCode).toBeNull()
    expect(secondSocket.readyState).toBe(MockWebSocket.OPEN)
  })
})
