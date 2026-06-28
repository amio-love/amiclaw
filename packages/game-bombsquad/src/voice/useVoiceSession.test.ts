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

  /** The control messages this socket received, parsed. */
  controlMessages(): Array<Record<string, unknown>> {
    return this.sent
      .filter((m): m is string => typeof m === 'string')
      .map((m) => JSON.parse(m) as Record<string, unknown>)
  }

  binaryFrameCount(): number {
    return this.sent.filter((m) => typeof m !== 'string').length
  }
}

class MockAudioContext {
  currentTime = 0
  destination = {}
  sampleRate: number
  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 48000
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
  createBufferSource() {
    return {
      buffer: null as unknown,
      connect() {},
      start() {},
      onended: null as Listener,
    }
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} }
  }
  createScriptProcessor() {
    return { connect() {}, disconnect() {}, onaudioprocess: null as Listener }
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

beforeEach(() => {
  MockWebSocket.instances = []
  getUserMedia.mockClear()
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

describe('useVoiceSession', () => {
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
    // Security invariant: no userId / prompt on the wire.
    expect(create).not.toHaveProperty('userId')
    expect(create).not.toHaveProperty('systemPrompt')
  })

  it('reaches ready on the created frame', () => {
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => ws.fireMessage({ type: 'created', sessionId: 'sess-1' }))
    expect(result.current.status).toBe('ready')
  })

  it('runs a full push-to-talk turn: capture -> turn -> stream -> ready', async () => {
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => ws.fireMessage({ type: 'created', sessionId: 'sess-1' }))

    await act(async () => {
      result.current.startTalking()
    })
    await waitFor(() => expect(result.current.status).toBe('in-turn'))
    expect(getUserMedia).toHaveBeenCalledOnce()

    act(() => result.current.stopTalking())
    const turn = ws.controlMessages().find((m) => m.type === 'turn')
    expect(turn).toBeDefined()

    act(() => {
      ws.fireMessage({ type: 'chunk', kind: 'text', text: 'Hold ', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'text', text: 'the button.', done: false })
    })
    expect(result.current.aiText).toBe('Hold the button.')

    // An audio chunk decodes + schedules playback without throwing, then done.
    const audioB64 = btoa(String.fromCharCode(0, 0, 1, 0))
    act(() => ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: false }))
    act(() => ws.fireMessage({ type: 'chunk', kind: 'text', text: '', done: true }))
    expect(result.current.status).toBe('ready')
  })

  it('surfaces a bounded mic error and stays usable when permission is denied', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('denied'))
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => ws.fireMessage({ type: 'created', sessionId: 'sess-1' }))

    await act(async () => {
      result.current.startTalking()
    })
    await waitFor(() => expect(result.current.error).toBe('microphone permission denied'))
    // Mic failure is not a transport failure — the session is still ready.
    expect(result.current.status).toBe('ready')
    // No turn was requested without audio.
    expect(ws.controlMessages().some((m) => m.type === 'turn')).toBe(false)
  })

  it('endSession sends end and lands closed with the summary', () => {
    const { result } = renderHook(() =>
      useVoiceSession({ manualData: manualData(), gameState: gameState() })
    )
    const ws = lastSocket()
    act(() => ws.fireOpen())
    act(() => ws.fireMessage({ type: 'created', sessionId: 'sess-1' }))

    act(() => result.current.endSession())
    expect(ws.controlMessages().some((m) => m.type === 'end')).toBe(true)

    const s = summary()
    act(() => ws.fireMessage({ type: 'summary', summary: s }))
    act(() => ws.fireClose(1000))
    expect(result.current.status).toBe('closed')
    expect(result.current.summary).toMatchObject({ turnCount: 1 })
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
    act(() => ws.fireClose(1008, 'turn before create'))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('1008')
    expect(result.current.error).toContain('turn before create')
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
