import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { GameState, ManualData, SessionSummary } from '@amiclaw/platform-ai/contract'
import { useVoiceSession } from './useVoiceSession'

// --- Mocks: WebSocket / AudioContext / getUserMedia ---

type Listener = ((arg?: unknown) => void) | null

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  url: string
  readyState = 0
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
    useVoiceSession({ manualData: manualData(), gameState: gameState() })
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
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    expect(result.current.status).toBe('connecting')
    const ws = lastSocket()
    expect(ws.url).toMatch(/^ws:\/\/[^/]+\/ai-ws\/bombsquad-/)

    act(() => ws.fireOpen())
    const create = ws.controlMessages()[0]
    expect(create).toMatchObject({
      type: 'create',
      gameId: 'bombsquad',
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

    // Four 256ms silence frames (>= 800ms hangover) end it -> a turn is sent.
    act(() => {
      fireFrame(0.0)
      fireFrame(0.0)
      fireFrame(0.0)
      fireFrame(0.0)
    })
    expect(result.current.playerSpeaking).toBe(false)
    expect(result.current.conversationPhase).toBe('thinking')
    expect(ws.controlMessages().some((m) => m.type === 'turn')).toBe(true)
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

    // Player barges in (2 frames >= the 400ms minSpeechMs).
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    expect(playing?.stopped).toBe(true)
    expect(result.current.isAiSpeaking).toBe(false)
    expect(result.current.playerSpeaking).toBe(true)
    expect(result.current.aiText).toBe('') // interrupted turn's text dropped

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
