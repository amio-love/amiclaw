import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../provider-config'
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
  defaultConnect,
  MessageFlag,
  MessageType,
  parseFrame,
  parseSttResponse,
  Serialization,
  TtsEvent,
  TtsHandshake,
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

/** Synchronous variant of {@link asyncFrom} for call sites that need the iterable inline. */
function asyncFromSync<T>(items: T[]): AsyncIterable<T> {
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

  it('sends the configured sttModel as request.model_name, not the default (F-K)', async () => {
    // F-K: the factory must thread `resolved.stt.model` into the adapter so the
    // config-selected ASR model reaches `request.model_name`. Here we set a
    // non-default `sttModel` and assert the FIRST outbound frame (the JSON config
    // request) carries it — proving the option is not dropped in favour of the
    // built-in `DEFAULT_STT_MODEL`.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({
      appId: 'a',
      accessToken: 't',
      sttModel: 'bigmodel-asr-pro',
      connect,
    })

    const consumed = (async () => {
      for await (const _chunk of stt.transcribe(await asyncFrom([encoder.encode('f1')]))) {
        break
      }
    })()
    await tick()

    const configFrame = parseFrame(socket.sent[0])
    const body = JSON.parse(decoder.decode(configFrame.payload)) as {
      request: { model_name: string }
    }
    expect(body.request.model_name).toBe('bigmodel-asr-pro')
    expect(body.request.model_name).not.toBe('bigmodel') // not the default

    // Unblock the consumer so nothing is left pending.
    socket.emitMessage(sttServerFrame({ result: { text: 'x', utterances: [{ definite: true }] } }))
    await consumed
  })

  it('falls back to the default sttModel when none is configured', async () => {
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const consumed = (async () => {
      for await (const _chunk of stt.transcribe(await asyncFrom([encoder.encode('f1')]))) {
        break
      }
    })()
    await tick()

    const configFrame = parseFrame(socket.sent[0])
    const body = JSON.parse(decoder.decode(configFrame.payload)) as {
      request: { model_name: string }
    }
    expect(body.request.model_name).toBe('bigmodel')

    socket.emitMessage(sttServerFrame({ result: { text: 'x', utterances: [{ definite: true }] } }))
    await consumed
  })

  it("resolveConfig('demo').stt.model is a legal Volcengine ASR wire model_name", async () => {
    // P2 regression: the `demo` config's STT model is threaded verbatim into the
    // ASR `request.model_name` (factory F-K passthrough). The Volcengine v3
    // streaming ASR endpoint (`/api/v3/sauc/bigmodel`) accepts ONLY `bigmodel` as
    // `model_name` — a config alias like `bigmodel-asr` was harmless before F-K
    // only because the adapter fell back to its own DEFAULT_STT_MODEL; now that
    // the resolved model is really transmitted, the alias would send an illegal
    // model id and fail the turn. This stitches the resolved config model directly
    // into the real adapter and asserts the wire frame, so the bad alias cannot
    // come back. Doc: https://www.volcengine.com/docs/6561/1354869
    const resolved = resolveConfig('demo')
    expect(resolved.stt.model).toBe('bigmodel')
    expect(resolved.stt.model).not.toBe('bigmodel-asr')

    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({
      appId: 'a',
      accessToken: 't',
      // Exactly what the factory threads through: `resolved.stt.model`.
      sttModel: resolved.stt.model,
      connect,
    })

    const consumed = (async () => {
      for await (const _chunk of stt.transcribe(await asyncFrom([encoder.encode('f1')]))) {
        break
      }
    })()
    await tick()

    const configFrame = parseFrame(socket.sent[0])
    const body = JSON.parse(decoder.decode(configFrame.payload)) as {
      request: { model_name: string }
    }
    expect(body.request.model_name).toBe('bigmodel')
    expect(body.request.model_name).not.toBe('bigmodel-asr')

    socket.emitMessage(sttServerFrame({ result: { text: 'x', utterances: [{ definite: true }] } }))
    await consumed
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

// --- TTS handshake state machine (pure, server-gated) -----------------------

describe('TtsHandshake', () => {
  it('resolves connectionStarted on a ConnectionStarted event', async () => {
    const hs = new TtsHandshake()
    let resolved = false
    void hs.connectionStarted.then(() => {
      resolved = true
    })
    expect(hs.handleEvent(TtsEvent.ConnectionStarted, () => '')).toBe(true)
    await hs.connectionStarted
    expect(resolved).toBe(true)
  })

  it('resolves sessionStarted on a SessionStarted event', async () => {
    const hs = new TtsHandshake()
    expect(hs.handleEvent(TtsEvent.SessionStarted, () => '')).toBe(true)
    await expect(hs.sessionStarted).resolves.toBeUndefined()
  })

  it('rejects connectionStarted on a ConnectionFailed event', async () => {
    const hs = new TtsHandshake()
    expect(hs.handleEvent(TtsEvent.ConnectionFailed, () => 'bad key')).toBe(true)
    await expect(hs.connectionStarted).rejects.toThrow(/connection failed: bad key/)
  })

  it('treats non-handshake events (audio / completion) as not consumed', () => {
    const hs = new TtsHandshake()
    expect(hs.handleEvent(TtsEvent.TtsResponse, () => '')).toBe(false)
    expect(hs.handleEvent(TtsEvent.SessionFinished, () => '')).toBe(false)
    expect(hs.handleEvent(undefined, () => '')).toBe(false)
  })

  it('resolves sessionFinished on a SessionFinished event (but reports it not consumed)', async () => {
    // SessionFinished (152) resolves the finish gate so the pump may send
    // FinishConnection, yet handleEvent returns false because the provider's
    // listener still owns pushing the final done chunk + closing the queue on it.
    const hs = new TtsHandshake()
    expect(hs.handleEvent(TtsEvent.SessionFinished, () => '')).toBe(false)
    await expect(hs.sessionFinished).resolves.toBeUndefined()
  })

  it('abort rejects the sessionFinished gate when the session never finishes', async () => {
    const hs = new TtsHandshake()
    hs.abort(new Error('socket closed before finish'))
    await expect(hs.sessionFinished).rejects.toThrow(/socket closed before finish/)
  })

  it('abort rejects every not-yet-settled gate', async () => {
    const hs = new TtsHandshake()
    hs.abort(new Error('socket closed early'))
    await expect(hs.connectionStarted).rejects.toThrow(/socket closed early/)
    await expect(hs.sessionStarted).rejects.toThrow(/socket closed early/)
  })

  it('abort after a gate already resolved does not override it', async () => {
    const hs = new TtsHandshake()
    hs.handleEvent(TtsEvent.ConnectionStarted, () => '')
    hs.abort(new Error('late close'))
    // The already-resolved connection gate stays resolved; only the still-pending
    // session gate is rejected.
    await expect(hs.connectionStarted).resolves.toBeUndefined()
    await expect(hs.sessionStarted).rejects.toThrow(/late close/)
  })
})

/**
 * Yield to the microtask/timer loop so the event-driven pump can react to the
 * server event we just emitted before we inspect outbound frames or emit the
 * next one. The handshake is now server-gated, so the pump only sends the next
 * client frame *after* the gating event arrives — the test must interleave.
 */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

/** Outbound event codes captured on the mock socket so far. */
function sentEvents(socket: MockSocket): Array<number | undefined> {
  return socket.sent.map((b) => parseFrame(b).event)
}

describe('createVolcengineSpeechProvider.tts.synthesize', () => {
  it('drives the server-gated event sequence and maps TTSResponse frames to audio', async () => {
    const socket = new MockSocket()
    const { connect, calls } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const text = await asyncFrom(['句一', '句二'])
    const collected = collect(tts.synthesize(text))

    // 1. The pump sends StartConnection FIRST and then waits — it must NOT have
    //    sent StartSession before the server accepts the connection.
    await tick()
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection])

    // 2. Server accepts the connection -> the pump may now send StartSession.
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection, TtsEvent.StartSession])

    // Read the session id the adapter assigned (from the StartSession frame).
    const startSession = socket.sent
      .map((b) => parseFrame(b))
      .find((f) => f.event === TtsEvent.StartSession)
    const sessionId = startSession?.sessionId ?? 's'

    // 3. Server accepts the session -> the pump sends the TaskRequests, then
    //    FinishSession + FinishConnection.
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()

    // 4. Server streams audio + SessionFinished.
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

    // Full outbound event sequence: StartConnection -> StartSession ->
    // TaskRequest(x2) -> FinishSession -> FinishConnection.
    expect(sentEvents(socket)).toEqual([
      TtsEvent.StartConnection,
      TtsEvent.StartSession,
      TtsEvent.TaskRequest,
      TtsEvent.TaskRequest,
      TtsEvent.FinishSession,
      TtsEvent.FinishConnection,
    ])
  })

  it('puts the configured ttsModel in the StartSession req_params, omitting it when unset (F-K)', async () => {
    // F-K: the factory threads `resolved.tts.model` into the adapter so a TTS
    // model switch in `provider-config` reaches the wire (the StartSession
    // `req_params.model`) instead of being silently dropped. With a model set it
    // must appear; with none set the field must be absent (default request shape).
    const withModelSocket = new MockSocket()
    const withModel = mockConnector(withModelSocket)
    const provider = createVolcengineSpeechProvider({
      appId: 'a',
      accessToken: 't',
      ttsModel: 'doubao-tts-2.0-pro',
      connect: withModel.connect,
    })
    void collect(provider.tts.synthesize(asyncFromSync(['句一'])))
    await tick()
    withModelSocket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()

    const startSession = withModelSocket.sent
      .map((b) => parseFrame(b))
      .find((f) => f.event === TtsEvent.StartSession)
    const body = JSON.parse(decoder.decode(startSession?.payload ?? new Uint8Array(0))) as {
      req_params: { model?: string }
    }
    expect(body.req_params.model).toBe('doubao-tts-2.0-pro')

    // With no ttsModel configured, the StartSession req_params omits `model`.
    const noModelSocket = new MockSocket()
    const noModel = mockConnector(noModelSocket)
    const plain = createVolcengineSpeechProvider({
      appId: 'a',
      accessToken: 't',
      connect: noModel.connect,
    })
    void collect(plain.tts.synthesize(asyncFromSync(['句一'])))
    await tick()
    noModelSocket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()

    const plainStartSession = noModelSocket.sent
      .map((b) => parseFrame(b))
      .find((f) => f.event === TtsEvent.StartSession)
    const plainBody = JSON.parse(
      decoder.decode(plainStartSession?.payload ?? new Uint8Array(0))
    ) as { req_params: { model?: string } }
    expect(plainBody.req_params.model).toBeUndefined()
  })

  it("resolveConfig('demo').tts.model is a legal Doubao TTS 2.0 wire req_params.model", async () => {
    // P2 regression: the `demo` config's TTS model is threaded verbatim into the
    // Doubao TTS 2.0 `StartSession` req_params.model (factory F-K passthrough).
    // The legal wire value is the model-family token `seed-tts-2.0`; the product
    // alias `doubao-tts-2.0` is NOT a request value and could be rejected / routed
    // to the wrong model. This stitches the resolved config model straight into the
    // real adapter and asserts the StartSession wire frame, so the bad alias cannot
    // come back. Doc: https://www.volcengine.com/docs/6561/1329505
    const resolved = resolveConfig('demo')
    expect(resolved.tts.model).toBe('seed-tts-2.0')
    expect(resolved.tts.model).not.toBe('doubao-tts-2.0')

    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({
      appId: 'a',
      accessToken: 't',
      // Exactly what the factory threads through: `resolved.tts.model`.
      ttsModel: resolved.tts.model,
      connect,
    })
    void collect(tts.synthesize(asyncFromSync(['句一'])))
    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()

    const startSession = socket.sent
      .map((b) => parseFrame(b))
      .find((f) => f.event === TtsEvent.StartSession)
    const body = JSON.parse(decoder.decode(startSession?.payload ?? new Uint8Array(0))) as {
      req_params: { model?: string }
    }
    expect(body.req_params.model).toBe('seed-tts-2.0')
    expect(body.req_params.model).not.toBe('doubao-tts-2.0')
  })

  it('does NOT send StartSession until the server accepts the connection', async () => {
    // Regression for F-G: the previous pump fired StartSession immediately after
    // StartConnection without waiting for ConnectionStarted, racing the server.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const collected = collect(tts.synthesize(await asyncFrom(['hi'])))

    // Several microtasks pass; with no ConnectionStarted the pump must stay at
    // StartConnection only — StartSession is gated.
    await tick()
    await tick()
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection])

    // Unblock the rest of the handshake so the stream can terminate cleanly.
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))
    await collected
  })

  it('does NOT send TaskRequest until the server accepts the session', async () => {
    // Regression for F-G: TaskRequest frames are session-scoped and must wait for
    // SessionStarted; sending them before the session is accepted gets them
    // rejected/ignored, yielding no audio.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const collected = collect(tts.synthesize(await asyncFrom(['念这句'])))

    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    // Connection accepted, session NOT yet accepted: only StartConnection +
    // StartSession sent, no TaskRequest.
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection, TtsEvent.StartSession])

    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()
    // Now the TaskRequest is allowed.
    expect(sentEvents(socket)).toContain(TtsEvent.TaskRequest)

    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))
    await collected
  })

  it('does NOT send FinishConnection until the server finishes the session (no tail-audio truncation)', async () => {
    // Regression for the close-side timing P2: the previous pump sent
    // FinishConnection immediately after FinishSession, before the server had
    // returned its remaining TTSResponse audio frames + SessionFinished (152).
    // Closing the connection at that point truncates the last synthesized audio.
    // The fix gates FinishConnection on SessionFinished, symmetric to the
    // start-side handshake — so the server's tail audio is fully drained first.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const collected = collect(tts.synthesize(await asyncFrom(['念完整一段话'])))

    // Walk the start-side handshake to where FinishSession has just been sent.
    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()

    // After FinishSession, the pump must NOT have sent FinishConnection yet — it
    // is gated on SessionFinished, which has not arrived.
    expect(sentEvents(socket)).toContain(TtsEvent.FinishSession)
    expect(sentEvents(socket)).not.toContain(TtsEvent.FinishConnection)

    // Server streams the remaining tail audio AFTER FinishSession. Each frame
    // arrives while the connection is still open and FinishConnection unsent.
    for (const tail of ['TAIL1', 'TAIL2', 'TAIL3']) {
      socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode(tail), sessionId))
      // Still no FinishConnection and the socket is still open mid-stream — the
      // close is strictly gated behind SessionFinished, so no frame is dropped.
      expect(sentEvents(socket)).not.toContain(TtsEvent.FinishConnection)
      expect(socket.closed).toBe(false)
    }

    // Only now does the server acknowledge the session is complete.
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))
    const chunks = await collected
    await tick()

    // Every tail audio frame was produced (none truncated), in order, followed by
    // the final done chunk — the iteration ended normally on SessionFinished.
    const audio = chunks.filter((c) => !c.done).map((c) => decoder.decode(c.audio))
    expect(audio).toEqual(['TAIL1', 'TAIL2', 'TAIL3'])
    expect(chunks[chunks.length - 1].done).toBe(true)

    // FinishConnection is sent exactly once, and only after FinishSession — i.e.
    // it is the last outbound frame, never racing ahead of the tail audio.
    const events = sentEvents(socket)
    expect(events).toEqual([
      TtsEvent.StartConnection,
      TtsEvent.StartSession,
      TtsEvent.TaskRequest,
      TtsEvent.FinishSession,
      TtsEvent.FinishConnection,
    ])
    expect(events.indexOf(TtsEvent.FinishConnection)).toBe(events.length - 1)
  })

  it('fails loudly on ConnectionFailed instead of hanging the handshake', async () => {
    // If the server rejects the connection, the gate the pump awaits must reject
    // so the turn fails fast rather than awaiting a frame that never comes.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const consumed = collect(tts.synthesize(await asyncFrom(['x'])))
    await tick()
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection])
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionFailed, encoder.encode('bad app key')))

    await expect(consumed).rejects.toThrow(/Volcengine TTS connection failed/)
    // The pump must NOT have advanced past StartConnection.
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection])
  })

  it('surfaces a SessionFailed event as a thrown error', async () => {
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const consumed = collect(tts.synthesize(await asyncFrom(['x'])))

    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()
    socket.emitMessage(
      ttsServerFrame(TtsEvent.SessionFailed, encoder.encode('quota exceeded'), sessionId)
    )

    await expect(consumed).rejects.toThrow(/Volcengine TTS session failed/)
  })

  it('rejects the pending gate if the socket closes before the handshake completes', async () => {
    // A socket close before ConnectionStarted must reject the awaited gate so the
    // pump fails loudly instead of awaiting a connection frame forever.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const consumed = collect(tts.synthesize(await asyncFrom(['x'])))
    await tick()
    socket.emitClose()

    // Close ends the queue (no audio); the pump's awaited gate rejected, but the
    // queue closing means the consumer simply sees an empty stream — assert it
    // terminates rather than hanging.
    const guard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('synthesize did not terminate after an early close')), 50)
    )
    await Promise.race([consumed, guard])
  })

  it('skips empty text pieces (no TaskRequest emitted for them)', async () => {
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ appId: 'a', accessToken: 't', connect })

    const collected = collect(tts.synthesize(await asyncFrom(['', 'real', ''])))

    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))

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

// --- Default Workers connector: binary frame delivery type (F-N) -------------

describe('defaultConnect — outbound socket binary delivery type (F-N)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * A stand-in for the Cloudflare `response.webSocket`. Records the order of the
   * `binaryType` write relative to `accept()` so the test can prove the opt-in is
   * applied BEFORE the socket is accepted (the runtime only honors it pre-accept).
   */
  class FakeRuntimeSocket {
    binaryType: 'blob' | 'arraybuffer' = 'blob'
    accepted = false
    /** `binaryType` value captured at the moment `accept()` ran. */
    binaryTypeAtAccept: 'blob' | 'arraybuffer' | undefined
    accept(): void {
      this.accepted = true
      this.binaryTypeAtAccept = this.binaryType
    }
  }

  function stubFetchWith(socket: FakeRuntimeSocket | undefined): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ webSocket: socket }) as unknown as Response)
    )
  }

  it('opts the outbound socket into arraybuffer delivery BEFORE accepting it', async () => {
    // F-N root fix: with compatibility_date 2026-06-08 the runtime delivers
    // inbound binary WS frames as Blob unless binaryType='arraybuffer' is set
    // before accept(). The synchronous `toBytes` codec only accepts ArrayBuffer /
    // views / strings, so a Blob would fail every ASR/TTS turn. Assert the real
    // connector both sets the type and sets it pre-accept (ordering is load-bearing).
    const socket = new FakeRuntimeSocket()
    stubFetchWith(socket)

    const returned = await defaultConnect('wss://example.test/v3', { Upgrade: 'websocket' })

    expect(socket.binaryType).toBe('arraybuffer')
    expect(socket.accepted).toBe(true)
    // The crux: arraybuffer was already in effect at the instant accept() ran.
    expect(socket.binaryTypeAtAccept).toBe('arraybuffer')
    expect(returned).toBe(socket as unknown as AdapterSocket)
  })

  it('throws when the upgrade response carries no webSocket', async () => {
    stubFetchWith(undefined)
    await expect(defaultConnect('wss://example.test/v3', { Upgrade: 'websocket' })).rejects.toThrow(
      /no webSocket on response/
    )
  })
})

describe('defaultConnect — fetch-upgrade URL scheme rewrite', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Minimal accept-only socket so `defaultConnect` resolves past the upgrade. */
  class AcceptableSocket {
    binaryType: 'blob' | 'arraybuffer' = 'blob'
    accept(): void {}
  }

  /**
   * Stub `fetch` so the test can read back the exact URL it received. The
   * Cloudflare custom-header WebSocket upgrade requires an `http(s)://` URL —
   * `ws:`/`wss:` are reserved for `new WebSocket()` and fail the `fetch` upgrade
   * before any turn starts. These tests pin the `wss:`->`https:` / `ws:`->`http:`
   * rewrite (and that host/path/query + the Upgrade + auth headers survive
   * untouched) so a scheme regression is caught here, not at deploy time.
   */
  function captureFetchUrl(): { calls: Array<{ url: string; init?: RequestInit }> } {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return { webSocket: new AcceptableSocket() } as unknown as Response
      })
    )
    return { calls }
  }

  it('rewrites wss:// to https:// while preserving host/path/query', async () => {
    const captured = captureFetchUrl()

    await defaultConnect('wss://openspeech.bytedance.com/api/v3/tts/bidirection?x=1', {
      Upgrade: 'websocket',
    })

    expect(captured.calls).toHaveLength(1)
    expect(captured.calls[0].url).toBe(
      'https://openspeech.bytedance.com/api/v3/tts/bidirection?x=1'
    )
  })

  it('rewrites ws:// to http:// while preserving host/path/query', async () => {
    const captured = captureFetchUrl()

    await defaultConnect('ws://example.test:8080/v3/sauc/bigmodel?a=b', { Upgrade: 'websocket' })

    expect(captured.calls).toHaveLength(1)
    expect(captured.calls[0].url).toBe('http://example.test:8080/v3/sauc/bigmodel?a=b')
  })

  it('passes the Upgrade + auth headers through unchanged after the rewrite', async () => {
    const captured = captureFetchUrl()
    const headers = {
      Upgrade: 'websocket',
      'X-Api-App-Key': 'app-123',
      'X-Api-Access-Key': 'token-456',
      'X-Api-Resource-Id': 'volc.bigasr.sauc.duration',
      'X-Api-Connect-Id': 'connect-789',
    }

    await defaultConnect('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel', headers)

    expect(captured.calls[0].url.startsWith('https://')).toBe(true)
    expect(captured.calls[0].init?.headers).toEqual(headers)
  })
})
