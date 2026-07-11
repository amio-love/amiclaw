import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { GameState, ManualData, SessionSummary } from '@amiclaw/platform-ai/contract'
import { useVoiceSession } from './useVoiceSession'

// --- Mocks: WebSocket / AudioContext / getUserMedia (browser-only play-green) ---

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
  fireOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
  fireMessage(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) })
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
  stopped = false
  connect(): void {}
  disconnect(): void {}
  start(): void {}
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

const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop() {} }] }))

function manualData(): ManualData {
  return { version: '1.1.0', sections: { objective: { title: '目标', lines: [] } } }
}
function gameState(sections: string[] = ['objective', 'compatibility']): GameState {
  return { relevantSections: sections }
}
function summary(): SessionSummary {
  return {
    sessionId: 's1',
    gameId: 'demo-mock',
    userId: 'dev-user',
    turnCount: 1,
    usage: { llmInputTokens: 0, llmOutputTokens: 0, sttInputSeconds: 0, ttsOutputSeconds: 0 },
  }
}

function captureProcessor(): MockScriptProcessor {
  const ctx = MockAudioContext.instances.find((c) => c.processor)
  if (!ctx?.processor) throw new Error('no capture processor yet')
  return ctx.processor
}

const SAMPLES = 4096
function fireFrame(amplitude: number): void {
  const data = new Float32Array(SAMPLES).fill(amplitude)
  captureProcessor().onaudioprocess?.({ inputBuffer: { getChannelData: () => data } })
}
const audioB64 = btoa(String.fromCharCode(0, 0, 1, 0))

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
afterEach(() => vi.unstubAllGlobals())

function lastSocket(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1)
  if (!ws) throw new Error('no WebSocket constructed')
  return ws
}

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

  it('connects same-origin as botanical- and sends create with demo-mock, no userId', () => {
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    expect(result.current.status).toBe('connecting')
    const ws = lastSocket()
    expect(ws.url).toMatch(/^ws:\/\/[^/]+\/ai-ws\/botanical-/)

    act(() => ws.fireOpen())
    const create = ws.controlMessages()[0]
    expect(create).toMatchObject({
      type: 'create',
      gameId: 'demo-mock',
      manualData: { version: '1.1.0' },
      gameState: { relevantSections: ['objective', 'compatibility'] },
    })
    expect(create).not.toHaveProperty('userId')
    expect(create).not.toHaveProperty('systemPrompt')
  })

  it('honors a custom gameId (the real demo path)', () => {
    renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState(), gameId: 'demo' })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    expect(ws.controlMessages()[0]).toMatchObject({ gameId: 'demo' })
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
    act(() => fireFrame(0.0))
    expect(ws.binaryFrameCount()).toBeGreaterThan(0)
  })

  it('renders the AI-first opening turn with no player input (thinking -> speaking)', async () => {
    const { result, ws } = await ready()
    expect(result.current.conversationPhase).toBe('thinking')
    act(() => {
      ws.fireMessage({ type: 'chunk', kind: 'text', text: '你好，', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'text', text: '我是植物学家。', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true })
    })
    expect(result.current.aiText).toBe('你好，我是植物学家。')
    expect(result.current.isAiSpeaking).toBe(true)
    expect(result.current.conversationPhase).toBe('speaking')
  })

  it('exposes the player transcript from a transcript frame', async () => {
    const { result, ws } = await ready()
    act(() => ws.fireMessage({ type: 'transcript', text: '这株兰花叶子发黄' }))
    expect(result.current.playerTranscript).toBe('这株兰花叶子发黄')
  })

  it('endSession sends end and lands closed with the summary', async () => {
    const { result, ws } = await ready()
    act(() => result.current.endSession())
    expect(ws.controlMessages().some((m) => m.type === 'end')).toBe(true)
    act(() => ws.fireMessage({ type: 'summary', summary: summary() }))
    act(() => ws.fireClose(1000))
    expect(result.current.status).toBe('closed')
    expect(result.current.summary).toMatchObject({ turnCount: 1 })
  })

  it('endSession sends end exactly once even when called twice', async () => {
    const { result, ws } = await ready()
    act(() => result.current.endSession())
    act(() => result.current.endSession())
    expect(ws.controlMessages().filter((m) => m.type === 'end')).toHaveLength(1)
  })

  it('treats a turn_in_flight server error as a benign no-op', async () => {
    const { result, ws } = await ready()
    act(() => ws.fireMessage({ type: 'error', code: 'turn_in_flight', message: 'busy' }))
    expect(result.current.error).toBeNull()
    expect(result.current.status).toBe('ready')
  })
})

function finishGreeting(ws: MockWebSocket): void {
  act(() => ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true }))
  const ctx = MockAudioContext.instances.find((c) => !c.processor && c.sources.length > 0)
  act(() => ctx?.sources.at(-1)?.onended?.())
}

describe('useVoiceSession — client VAD', () => {
  it('sends speech-start then turn, in order, for a real player utterance', async () => {
    const { ws } = await ready()
    finishGreeting(ws)
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    expect(ws.controlMessages().filter((m) => m.type === 'speech-start')).toHaveLength(1)
    expect(ws.controlMessages().some((m) => m.type === 'turn')).toBe(false)
    act(() => {
      for (let i = 0; i < 10; i += 1) fireFrame(0.0)
    })
    const types = ws.controlMessages().map((m) => m.type)
    expect(types.filter((t) => t === 'speech-start')).toHaveLength(1)
    expect(types.filter((t) => t === 'turn')).toHaveLength(1)
    expect(types.indexOf('turn')).toBeGreaterThan(types.indexOf('speech-start'))
  })

  it('does not send speech-start while the opening greeting is in flight', async () => {
    const { ws } = await ready()
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
      fireFrame(0.0)
      fireFrame(0.0)
    })
    expect(ws.controlMessages().some((m) => m.type === 'speech-start')).toBe(false)
  })
})

describe('useVoiceSession — garden-state steering', () => {
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

  it('sends the first selection via create and never an update for it', async () => {
    const { ws } = await readyWithGameState(gameState(['objective', 'light']))
    expect(ws.controlMessages().find((m) => m.type === 'create')).toMatchObject({
      gameState: { relevantSections: ['objective', 'light'] },
    })
    expect(ws.controlMessages().some((m) => m.type === 'update-gamestate')).toBe(false)
  })

  it('steers ONE update-gamestate on the SAME socket when the sections change', async () => {
    const { ws, rerender } = await readyWithGameState(gameState(['objective', 'light']))
    const socketsBefore = MockWebSocket.instances.length
    act(() => rerender({ gs: gameState(['objective', 'species_care:orchid', 'growth']) }))
    const updates = ws.controlMessages().filter((m) => m.type === 'update-gamestate')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      gameState: { relevantSections: ['objective', 'species_care:orchid', 'growth'] },
    })
    expect(MockWebSocket.instances.length).toBe(socketsBefore)
    expect(ws.controlMessages().filter((m) => m.type === 'create')).toHaveLength(1)
  })

  it('does not steer when a re-render leaves the sections unchanged', async () => {
    const { ws, rerender } = await readyWithGameState(gameState(['objective', 'light']))
    act(() => rerender({ gs: gameState(['objective', 'light']) }))
    expect(ws.controlMessages().some((m) => m.type === 'update-gamestate')).toBe(false)
  })

  it('does not steer before the session is created', async () => {
    const rendered = renderHook(
      ({ gs }: { gs: GameState }) => useVoiceSession({ manualData: manualData(), gameState: gs }),
      { initialProps: { gs: gameState(['objective']) } }
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => rendered.rerender({ gs: gameState(['objective', 'light']) }))
    expect(ws.controlMessages().some((m) => m.type === 'update-gamestate')).toBe(false)
    await act(async () => {
      ws.fireMessage({ type: 'created', sessionId: 'sess-1' })
    })
    expect(ws.controlMessages().filter((m) => m.type === 'update-gamestate')).toHaveLength(1)
  })
})

describe('useVoiceSession — text fallback', () => {
  it('sends a typed question as a text-turn on the live socket', async () => {
    const { result, ws } = await ready()
    act(() => result.current.sendText('这株兰花怎么救'))
    expect(ws.controlMessages()).toContainEqual({ type: 'text-turn', text: '这株兰花怎么救' })
  })

  it('trims and ignores an empty typed question', async () => {
    const { result, ws } = await ready()
    act(() => result.current.sendText('   '))
    expect(ws.controlMessages().some((m) => m.type === 'text-turn')).toBe(false)
  })

  it('does not send a text-turn before the session is live', () => {
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket() // connecting: socket not OPEN yet
    act(() => result.current.sendText('在吗'))
    expect(ws.controlMessages().some((m) => m.type === 'text-turn')).toBe(false)
  })
})

describe('useVoiceSession — barge-in', () => {
  it('stops playback and drops the interrupted turn when the player talks over it', async () => {
    const { result, ws } = await ready()
    act(() => {
      ws.fireMessage({ type: 'chunk', kind: 'text', text: '这一条很长的建议', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: false })
    })
    expect(result.current.isAiSpeaking).toBe(true)
    const before = ws.controlMessages().filter((m) => m.type === 'speech-start').length
    act(() => {
      fireFrame(0.5)
      fireFrame(0.5)
    })
    expect(result.current.isAiSpeaking).toBe(false)
    expect(result.current.aiText).toBe('')
    expect(ws.controlMessages().filter((m) => m.type === 'speech-start').length).toBe(before + 1)
  })
})
