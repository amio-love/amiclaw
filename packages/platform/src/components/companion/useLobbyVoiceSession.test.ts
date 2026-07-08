/**
 * `useLobbyVoiceSession` — the manual-less lobby voice session.
 *
 * Pins the load-bearing lobby-specific contract:
 *  - the MANUAL-LESS create envelope (companion-lobby, empty manual, no gameRunId,
 *    opening on);
 *  - a pre-granted stream is REUSED (no second getUserMedia);
 *  - the streamed greeting drives `aiText` / `isAiSpeaking`;
 *  - the three-layer cost guard (silence / turn-cap / max-duration) each ends the
 *    session;
 *  - the ABRUPT-CLOSE NO-CAPTURE invariant: the hook NEVER sends `{type:'end'}`,
 *    so the server's end-branch — the ONLY path that hands a summary to the
 *    consolidator — never runs. Lobby chit-chat can never become a memory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  LOBBY_MAX_DURATION_MS,
  LOBBY_MAX_PLAYER_TURNS,
  LOBBY_SILENCE_TIMEOUT_MS,
  useLobbyVoiceSession,
} from './useLobbyVoiceSession'

type Listener = ((arg?: unknown) => void) | null

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []
  url: string
  readyState = 0
  sent: Array<string | ArrayBuffer> = []
  closed = false
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
    this.closed = true
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
  controlMessages(): Array<Record<string, unknown>> {
    return this.sent
      .filter((m): m is string => typeof m === 'string')
      .map((m) => JSON.parse(m) as Record<string, unknown>)
  }
  sentTypes(): string[] {
    return this.controlMessages().map((m) => String(m.type))
  }
}

class MockBufferSource {
  buffer: unknown = null
  onended: Listener = null
  connect(): void {}
  disconnect(): void {}
  start(): void {}
  stop(): void {}
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
    this.sampleRate = opts?.sampleRate ?? 16000
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
const audioB64 = btoa(String.fromCharCode(0, 0, 1, 0))
const SAMPLES = 4096 // matches CAPTURE_BUFFER_SIZE; 256ms/frame at 16 kHz.

function captureProcessor(): MockScriptProcessor {
  const ctx = MockAudioContext.instances.find((c) => c.processor)
  if (!ctx?.processor) throw new Error('no capture processor yet')
  return ctx.processor
}
function playbackSources(): MockBufferSource[] {
  const ctx = MockAudioContext.instances.find((c) => !c.processor && c.sources.length > 0)
  return ctx?.sources ?? []
}
function lastSocket(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1)
  if (!ws) throw new Error('no WebSocket constructed')
  return ws
}

/** Fire one capture frame of the given constant amplitude through the VAD path. */
function fireFrame(amplitude: number): void {
  const data = new Float32Array(SAMPLES).fill(amplitude)
  captureProcessor().onaudioprocess?.({ inputBuffer: { getChannelData: () => data } })
}

/** Drain queued microtasks so an awaited getUserMedia inside startCapture settles. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
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
  Object.defineProperty(window, 'location', {
    value: { protocol: 'https:', host: 'claw.amio.fans' },
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Open a live lobby session: open → ws.open → created → capture streaming. */
async function openLive(stream?: MediaStream) {
  const rendered = renderHook(() => useLobbyVoiceSession())
  act(() => rendered.result.current.open(stream))
  const ws = lastSocket()
  act(() => ws.fireOpen())
  await act(async () => {
    ws.fireMessage({ type: 'created', sessionId: 'lobby-1' })
  })
  await flush()
  return { ...rendered, ws }
}

describe('useLobbyVoiceSession — manual-less create', () => {
  it('stays idle until open() is called', () => {
    const { result } = renderHook(() => useLobbyVoiceSession())
    expect(result.current.status).toBe('idle')
    expect(result.current.live).toBe(false)
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('open() sends a manual-less companion-lobby create with opening on and no gameRunId', async () => {
    const { ws } = await openLive()
    const create = ws.controlMessages().find((m) => m.type === 'create')
    expect(create).toBeDefined()
    expect(create).toMatchObject({
      type: 'create',
      gameId: 'companion-lobby',
      opening: true,
      gameState: { relevantSections: [] },
    })
    expect(create!.manualData).toEqual({ version: 'lobby', sections: {} })
    expect(create!.gameRunId).toBeUndefined()
    // No provider key / system prompt / userId ever ride the wire.
    expect(JSON.stringify(create)).not.toMatch(/apiKey|systemPrompt|userId/i)
  })

  it('reuses a pre-granted stream instead of prompting for the mic again', async () => {
    const preGranted = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream
    await openLive(preGranted)
    // The stream from the permission probe is reused — no second getUserMedia.
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(captureProcessor()).toBeTruthy()
  })

  it('acquires the mic itself when no stream is handed in', async () => {
    await openLive()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})

describe('useLobbyVoiceSession — greeting', () => {
  it('the streamed greeting drives aiText and isAiSpeaking', async () => {
    const { result, ws } = await openLive()
    await act(async () => {
      ws.fireMessage({ type: 'chunk', kind: 'text', text: '嘿，回来了。', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true })
    })
    expect(result.current.aiText).toBe('嘿，回来了。')
    expect(result.current.isAiSpeaking).toBe(true)
    expect(result.current.conversationPhase).toBe('speaking')
  })
})

describe('useLobbyVoiceSession — cost guard (abrupt close, never `end`)', () => {
  it('layer 3: the hard-max duration ends the session', async () => {
    const { result, ws } = await openLive()
    expect(ws.closed).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(LOBBY_MAX_DURATION_MS + 10)
    })
    expect(ws.closed).toBe(true)
    expect(result.current.live).toBe(false)
    // Abrupt close — NO `end` was ever sent (⇒ no server summary hand-off).
    expect(ws.sentTypes()).not.toContain('end')
  })

  it('layer 1: continuous idle silence ends the session', async () => {
    const { result, ws } = await openLive()
    // Reach a fully-idle listening state: the greeting audio plays then ends.
    await act(async () => {
      ws.fireMessage({ type: 'chunk', kind: 'text', text: '在呢。', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true })
    })
    // The greeting audio frame ends → isAiSpeaking false → idle listening.
    await act(async () => {
      playbackSources().forEach((s) => s.onended?.())
    })
    expect(result.current.conversationPhase).toBe('listening')
    expect(ws.closed).toBe(false)
    // Nothing happens for the silence window → the session ends.
    await act(async () => {
      vi.advanceTimersByTime(LOBBY_SILENCE_TIMEOUT_MS + 10)
    })
    expect(ws.closed).toBe(true)
    expect(ws.sentTypes()).not.toContain('end')
  })

  it('layer 2: the player-turn cap ends the session after the cap is reached', async () => {
    const { ws } = await openLive()
    // Settle the greeting so the AI does not hold the floor.
    await act(async () => {
      ws.fireMessage({ type: 'chunk', kind: 'text', text: '在呢。', done: false })
      ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true })
      playbackSources().forEach((s) => s.onended?.())
    })
    // Drive LOBBY_MAX_PLAYER_TURNS full player utterances (speech then silence),
    // each answered so the AI is idle before the next.
    for (let turn = 0; turn < LOBBY_MAX_PLAYER_TURNS; turn += 1) {
      await act(async () => {
        fireFrame(0.5) // speech-start
        fireFrame(0.5)
      })
      await act(async () => {
        for (let i = 0; i < 12; i += 1) fireFrame(0) // trailing silence → utterance-end → turn
      })
      await act(async () => {
        ws.fireMessage({ type: 'chunk', kind: 'text', text: '好。', done: false })
        ws.fireMessage({ type: 'chunk', kind: 'audio', audio: audioB64, done: true })
        playbackSources().forEach((s) => s.onended?.())
      })
    }
    const turnSends = ws.sentTypes().filter((t) => t === 'turn').length
    expect(turnSends).toBe(LOBBY_MAX_PLAYER_TURNS)
    // Once idle after the capped turn, the session ends — with no `end` sent.
    expect(ws.closed).toBe(true)
    expect(ws.sentTypes()).not.toContain('end')
  })

  it('caller close() tears down abruptly without an `end`', async () => {
    const { result, ws } = await openLive()
    act(() => result.current.close())
    expect(ws.closed).toBe(true)
    expect(result.current.live).toBe(false)
    expect(ws.sentTypes()).not.toContain('end')
  })
})
