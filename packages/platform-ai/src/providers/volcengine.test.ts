import { describe, expect, it } from 'vitest'
import {
  buildAuthHeaders,
  buildSttAudioFrame,
  buildSttConfigFrame,
  buildSttRequestFrame,
  buildTtsEventFrame,
  buildTtsFinishConnectionFrame,
  buildTtsFinishSessionFrame,
  buildTtsStartConnectionFrame,
  buildTtsStartSessionFrame,
  buildTtsTaskRequestFrame,
  Compression,
  createVolcengineSpeechProvider,
  MessageFlag,
  MessageType,
  parseFrame,
  parseSttResponse,
  Serialization,
  TtsEvent,
  type AdapterSocket,
  type WebSocketConnector,
} from './volcengine'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// --- Test doubles -----------------------------------------------------------

type Listener = (event: { data: unknown }) => void

/**
 * Mock WebSocket: records every outbound frame and lets the test drive inbound
 * messages / lifecycle events. No real network — this is how the streaming glue
 * is exercised end to end.
 */
class MockSocket implements AdapterSocket {
  sent: Uint8Array[] = []
  closed = false
  private messageListeners: Listener[] = []
  private closeListeners: Array<() => void> = []
  private errorListeners: Array<(event: unknown) => void> = []

  send(data: ArrayBuffer | ArrayBufferView): void {
    this.sent.push(
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    )
  }

  close(): void {
    this.closed = true
  }

  // The adapter registers exactly one listener per event kind; we fan out so
  // the test can emit messages/close/error after wiring. A single permissive
  // overload keeps the implementation signature compatible with the interface.
  addEventListener(
    type: 'message' | 'close' | 'error',
    listener: ((event: { data: unknown }) => void) | (() => void) | ((event: unknown) => void)
  ): void {
    if (type === 'message') this.messageListeners.push(listener as Listener)
    else if (type === 'close') this.closeListeners.push(listener as () => void)
    else if (type === 'error') this.errorListeners.push(listener as (event: unknown) => void)
  }

  emitMessage(data: Uint8Array): void {
    for (const l of this.messageListeners) l({ data })
  }

  emitClose(): void {
    for (const l of this.closeListeners) l()
  }

  emitError(event: unknown): void {
    for (const l of this.errorListeners) l(event)
  }
}

function mockConnector(socket: MockSocket): {
  connect: WebSocketConnector
  calls: Array<{ url: string; headers: Record<string, string> }>
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const connect: WebSocketConnector = async (url, headers) => {
    calls.push({ url, headers })
    return socket
  }
  return { connect, calls }
}

async function asyncFrom<T>(items: T[]): Promise<AsyncIterable<T>> {
  return (async function* () {
    for (const item of items) yield item
  })()
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of stream) out.push(item)
  return out
}

/** Build an ASR JSON server-response frame the way the wire encodes it. */
function sttServerFrame(body: unknown, flags = MessageFlag.PositiveSequence): Uint8Array {
  const payload = encoder.encode(JSON.stringify(body))
  return buildSttRequestFrame({
    messageType: MessageType.FullServerResponse,
    flags,
    serialization: Serialization.Json,
    sequence: 1,
    payload,
  })
}

/** Build a TTS server event frame (audio or lifecycle). */
function ttsServerFrame(event: number, payload: Uint8Array, sessionId = 's'): Uint8Array {
  return buildTtsEventFrame({ event, sessionId, payload })
}

// --- Auth header assembly ---------------------------------------------------

describe('buildAuthHeaders', () => {
  it('maps credentials onto the X-Api-* handshake headers + Upgrade', () => {
    const headers = buildAuthHeaders(
      { appId: 'app-1', accessToken: 'tok-2', resourceId: 'volc.bigasr.sauc.duration' },
      'conn-3'
    )
    // v3 token-header auth: app key + access key + resource id + per-connection
    // connect id. No signature header, no secret key.
    expect(headers).toEqual({
      Upgrade: 'websocket',
      'X-Api-App-Key': 'app-1',
      'X-Api-Access-Key': 'tok-2',
      'X-Api-Resource-Id': 'volc.bigasr.sauc.duration',
      'X-Api-Connect-Id': 'conn-3',
    })
  })

  it('never leaks credentials into a logged value: only the documented keys exist', () => {
    const headers = buildAuthHeaders({ appId: 'a', accessToken: 'secret', resourceId: 'r' }, 'q')
    // Guard against an accidental extra field carrying credentials elsewhere.
    expect(Object.keys(headers).sort()).toEqual([
      'Upgrade',
      'X-Api-Access-Key',
      'X-Api-App-Key',
      'X-Api-Connect-Id',
      'X-Api-Resource-Id',
    ])
  })
})

// --- ASR frame build + parse round-trip -------------------------------------

describe('STT frame codec', () => {
  it('encodes the 4-byte protocol header (version 1, header size 1)', () => {
    const frame = buildSttConfigFrame({
      uid: 'u',
      format: 'pcm',
      sampleRate: 16000,
      model: 'bigmodel',
    })
    expect(frame[0]).toBe(0x11)
    // byte1 = (FullClientRequest << 4) | PositiveSequence
    expect(frame[1]).toBe((MessageType.FullClientRequest << 4) | MessageFlag.PositiveSequence)
    // byte2 = (JSON << 4) | None
    expect(frame[2]).toBe((Serialization.Json << 4) | Compression.None)
    expect(frame[3]).toBe(0x00)
  })

  it('places a 4-byte big-endian sequence between header and payload size', () => {
    const payload = encoder.encode('xy')
    const frame = buildSttRequestFrame({
      messageType: MessageType.AudioOnlyClient,
      flags: MessageFlag.PositiveSequence,
      serialization: Serialization.None,
      sequence: 7,
      payload,
    })
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getInt32(4, false)).toBe(7) // sequence
    expect(view.getInt32(8, false)).toBe(2) // payload size
    expect(decoder.decode(frame.subarray(12))).toBe('xy')
  })

  it('config frame round-trips through parseFrame with the documented JSON shape', () => {
    const frame = buildSttConfigFrame({
      uid: 'user-9',
      format: 'pcm',
      sampleRate: 24000,
      model: 'bigmodel',
    })
    const parsed = parseFrame(frame)
    expect(parsed.messageType).toBe(MessageType.FullClientRequest)
    expect(parsed.sequence).toBe(1)
    expect(parsed.serialization).toBe(Serialization.Json)
    const body = JSON.parse(decoder.decode(parsed.payload))
    expect(body).toEqual({
      user: { uid: 'user-9' },
      audio: { format: 'pcm', rate: 24000, bits: 16, channel: 1 },
      request: { model_name: 'bigmodel', enable_punc: true, enable_itn: true },
    })
  })

  it('flags the final audio packet with a negative sequence + NegativeWithSequence', () => {
    const last = buildSttAudioFrame(encoder.encode('aud'), 5, true)
    const parsed = parseFrame(last)
    expect(parsed.messageType).toBe(MessageType.AudioOnlyClient)
    expect(parsed.flags).toBe(MessageFlag.NegativeWithSequence)
    expect(parsed.sequence).toBe(-5)
    expect(decoder.decode(parsed.payload)).toBe('aud')
  })

  it('non-final audio packet keeps a positive sequence', () => {
    const mid = buildSttAudioFrame(encoder.encode('aud'), 3, false)
    const parsed = parseFrame(mid)
    expect(parsed.flags).toBe(MessageFlag.PositiveSequence)
    expect(parsed.sequence).toBe(3)
  })
})

// --- ASR server-response mapping --------------------------------------------

describe('parseSttResponse', () => {
  it('maps a non-definite utterance to a non-final transcript chunk', () => {
    const chunk = parseSttResponse(
      parseFrame(sttServerFrame({ result: { text: '你好', utterances: [{ definite: false }] } }))
    )
    expect(chunk).toEqual({ text: '你好', isFinal: false })
  })

  it('marks the chunk final when any utterance is definite', () => {
    const chunk = parseSttResponse(
      parseFrame(
        sttServerFrame({
          result: { text: '你好世界', utterances: [{ definite: false }, { definite: true }] },
        })
      )
    )
    expect(chunk).toEqual({ text: '你好世界', isFinal: true })
  })

  it('treats a missing utterances array as not-final', () => {
    const chunk = parseSttResponse(parseFrame(sttServerFrame({ result: { text: 'hi' } })))
    expect(chunk).toEqual({ text: 'hi', isFinal: false })
  })

  it('returns undefined for an empty / textless ack frame', () => {
    const ack = buildSttRequestFrame({
      messageType: MessageType.FullServerResponse,
      flags: MessageFlag.PositiveSequence,
      serialization: Serialization.Json,
      sequence: 1,
      payload: encoder.encode(JSON.stringify({ result: {} })),
    })
    expect(parseSttResponse(parseFrame(ack))).toBeUndefined()
  })

  it('throws on an error-type server frame', () => {
    const errFrame = buildSttRequestFrame({
      messageType: MessageType.ErrorResponse,
      flags: MessageFlag.PositiveSequence,
      serialization: Serialization.Json,
      sequence: 1,
      payload: encoder.encode('bad credentials'),
    })
    expect(() => parseSttResponse(parseFrame(errFrame))).toThrowError(/Volcengine ASR error/)
  })
})

// --- TTS event frame build + parse round-trip -------------------------------

describe('TTS event frame codec', () => {
  it('encodes the WithEvent flag and the event / sessionId / payload layout', () => {
    const frame = buildTtsEventFrame({
      event: TtsEvent.StartSession,
      sessionId: 'sess-1',
      payload: encoder.encode('{}'),
    })
    expect(frame[0]).toBe(0x11)
    expect(frame[1]).toBe((MessageType.FullClientRequest << 4) | MessageFlag.WithEvent)

    const parsed = parseFrame(frame)
    expect(parsed.event).toBe(TtsEvent.StartSession)
    expect(parsed.sessionId).toBe('sess-1')
    expect(decoder.decode(parsed.payload)).toBe('{}')
  })

  it('StartConnection / FinishConnection carry an empty session id', () => {
    for (const frame of [buildTtsStartConnectionFrame(), buildTtsFinishConnectionFrame()]) {
      const parsed = parseFrame(frame)
      expect(parsed.sessionId).toBe('')
    }
    expect(parseFrame(buildTtsStartConnectionFrame()).event).toBe(TtsEvent.StartConnection)
    expect(parseFrame(buildTtsFinishConnectionFrame()).event).toBe(TtsEvent.FinishConnection)
  })

  it('StartSession payload carries speaker + audio params', () => {
    const parsed = parseFrame(
      buildTtsStartSessionFrame({ sessionId: 's', speaker: 'voice-x', sampleRate: 24000 })
    )
    const body = JSON.parse(decoder.decode(parsed.payload))
    expect(body.event).toBe(TtsEvent.StartSession)
    expect(body.req_params.speaker).toBe('voice-x')
    expect(body.req_params.audio_params).toEqual({ format: 'pcm', sample_rate: 24000 })
  })

  it('TaskRequest payload carries the text chunk', () => {
    const parsed = parseFrame(
      buildTtsTaskRequestFrame({ sessionId: 's', text: '念这句', speaker: 'voice-x' })
    )
    const body = JSON.parse(decoder.decode(parsed.payload))
    expect(body.event).toBe(TtsEvent.TaskRequest)
    expect(body.req_params.text).toBe('念这句')
  })

  it('FinishSession round-trips the session id', () => {
    const parsed = parseFrame(buildTtsFinishSessionFrame('sess-z'))
    expect(parsed.event).toBe(TtsEvent.FinishSession)
    expect(parsed.sessionId).toBe('sess-z')
  })
})

// --- parseFrame guards ------------------------------------------------------

describe('parseFrame guards', () => {
  it('throws on a frame shorter than the 4-byte header', () => {
    expect(() => parseFrame(new Uint8Array([0x11, 0x10]))).toThrowError(/4-byte header/)
  })

  it('accepts an ArrayBuffer payload as well as a Uint8Array', () => {
    const frame = buildTtsStartConnectionFrame()
    const viaArrayBuffer = parseFrame(frame.buffer.slice(0))
    expect(viaArrayBuffer.event).toBe(TtsEvent.StartConnection)
  })
})

// --- Streaming logic: transcribe (mock WS) ----------------------------------

describe('createVolcengineSpeechProvider.stt.transcribe', () => {
  it('sends config then audio frames and maps server responses to transcript chunks', async () => {
    const socket = new MockSocket()
    const { connect, calls } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({
      appId: 'a',
      accessToken: 't',
      connect,
    })

    const audio = await asyncFrom([encoder.encode('f1'), encoder.encode('f2')])
    const stream = stt.transcribe(audio)

    // Drive the consumer in the background, then feed server responses.
    const collected = (async () => {
      const out = []
      for await (const chunk of stream) {
        out.push(chunk)
        if (chunk.isFinal) break
      }
      return out
    })()

    // Let the pump send its frames before we emit responses.
    await new Promise((r) => setTimeout(r, 0))
    socket.emitMessage(
      sttServerFrame({ result: { text: '你', utterances: [{ definite: false }] } })
    )
    socket.emitMessage(
      sttServerFrame({ result: { text: '你好', utterances: [{ definite: true }] } })
    )

    const chunks = await collected
    expect(chunks).toEqual([
      { text: '你', isFinal: false },
      { text: '你好', isFinal: true },
    ])

    // Connected to the ASR endpoint with the ASR resource id.
    expect(calls[0].url).toContain('/sauc/bigmodel')
    expect(calls[0].headers['X-Api-Resource-Id']).toBe('volc.bigasr.sauc.duration')

    // First outbound frame is the JSON config (FullClientRequest); the last is
    // the negative-sequence final audio packet.
    const first = parseFrame(socket.sent[0])
    expect(first.messageType).toBe(MessageType.FullClientRequest)
    const last = parseFrame(socket.sent[socket.sent.length - 1])
    expect(last.messageType).toBe(MessageType.AudioOnlyClient)
    expect(last.flags).toBe(MessageFlag.NegativeWithSequence)
    expect(last.sequence).toBeLessThan(0)
  })

  it('ends the iteration on a definite transcript without waiting for a WS close', async () => {
    // Regression: `collectFinalTranscript` drains `transcribe` to iterator end
    // (it does not break early like the test above). If the adapter only closed
    // on a separate WS `close` event, a server that keeps the socket open after
    // the definite result would hang the whole turn. Here the server emits a
    // definite frame and never closes the socket; the iterator must still end
    // and surface the final chunk.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const audio = await asyncFrom([encoder.encode('f1')])
    // Drain to iterator end (no early break) — the exact shape the turn pipeline
    // uses. Race against a timer so a hang fails the test instead of stalling.
    const drained = (async () => {
      const out = []
      for await (const chunk of stt.transcribe(audio)) out.push(chunk)
      return out
    })()
    const guard = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('transcribe did not terminate on a definite transcript')),
        50
      )
    )

    await new Promise((r) => setTimeout(r, 0))
    socket.emitMessage(
      sttServerFrame({ result: { text: '在', utterances: [{ definite: false }] } })
    )
    socket.emitMessage(
      sttServerFrame({ result: { text: '在的', utterances: [{ definite: true }] } })
    )
    // Intentionally do NOT emit a WS `close` — termination must come from the
    // definite transcript alone.

    const chunks = await Promise.race([drained, guard])
    expect(chunks).toEqual([
      { text: '在', isFinal: false },
      { text: '在的', isFinal: true },
    ])
    // The adapter also closes the ASR socket as the normal end-of-stream path.
    expect(socket.closed).toBe(true)
  })

  it('propagates a server error frame as a thrown error', async () => {
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const stream = stt.transcribe(await asyncFrom([encoder.encode('f')]))
    const consumed = collect(stream)

    await new Promise((r) => setTimeout(r, 0))
    const errFrame = buildSttRequestFrame({
      messageType: MessageType.ErrorResponse,
      flags: MessageFlag.PositiveSequence,
      serialization: Serialization.Json,
      sequence: 1,
      payload: encoder.encode('auth failed'),
    })
    socket.emitMessage(errFrame)

    await expect(consumed).rejects.toThrow(/Volcengine ASR error/)
  })
})

// --- Streaming logic: synthesize (mock WS) ----------------------------------

describe('createVolcengineSpeechProvider.tts.synthesize', () => {
  it('drives the event sequence and maps TTSResponse frames to audio chunks', async () => {
    const socket = new MockSocket()
    const { connect, calls } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const text = await asyncFrom(['句一', '句二'])
    const stream = tts.synthesize(text)
    const collected = collect(stream)

    await new Promise((r) => setTimeout(r, 0))
    // Read the session id the adapter assigned (from a session-scoped frame).
    const startSession = socket.sent
      .map((b) => parseFrame(b))
      .find((f) => f.event === TtsEvent.StartSession)
    const sessionId = startSession?.sessionId ?? 's'

    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('AUDIO1'), sessionId))
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('AUDIO2'), sessionId))
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))

    const chunks = await collected
    expect(chunks.slice(0, 2)).toEqual([
      { audio: encoder.encode('AUDIO1'), done: false },
      { audio: encoder.encode('AUDIO2'), done: false },
    ])
    const final = chunks[chunks.length - 1]
    expect(final.done).toBe(true)

    // Connected to the TTS endpoint with the TTS resource id.
    expect(calls[0].url).toContain('/tts/bidirection')
    expect(calls[0].headers['X-Api-Resource-Id']).toBe('volc.service_type.10029')

    // The outbound event sequence is StartConnection -> StartSession ->
    // TaskRequest(x2) -> FinishSession -> FinishConnection.
    const events = socket.sent.map((b) => parseFrame(b).event)
    expect(events).toEqual([
      TtsEvent.StartConnection,
      TtsEvent.StartSession,
      TtsEvent.TaskRequest,
      TtsEvent.TaskRequest,
      TtsEvent.FinishSession,
      TtsEvent.FinishConnection,
    ])
  })

  it('surfaces a SessionFailed event as a thrown error', async () => {
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const stream = tts.synthesize(await asyncFrom(['x']))
    const consumed = collect(stream)

    await new Promise((r) => setTimeout(r, 0))
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFailed, encoder.encode('quota exceeded')))

    await expect(consumed).rejects.toThrow(/Volcengine TTS session failed/)
  })

  it('skips empty text pieces (no TaskRequest emitted for them)', async () => {
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const stream = tts.synthesize(await asyncFrom(['', 'real', '']))
    const collected = collect(stream)

    await new Promise((r) => setTimeout(r, 0))
    const startSession = socket.sent
      .map((b) => parseFrame(b))
      .find((f) => f.event === TtsEvent.StartSession)
    socket.emitMessage(
      ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), startSession?.sessionId ?? 's')
    )

    await collected
    const taskRequests = socket.sent
      .map((b) => parseFrame(b))
      .filter((f) => f.event === TtsEvent.TaskRequest)
    expect(taskRequests).toHaveLength(1)
    expect(JSON.parse(decoder.decode(taskRequests[0].payload)).req_params.text).toBe('real')
  })

  it('shares one provider instance across the STT and TTS slots', () => {
    const provider = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't' })
    expect(typeof provider.stt.transcribe).toBe('function')
    expect(typeof provider.tts.synthesize).toBe('function')
  })
})
