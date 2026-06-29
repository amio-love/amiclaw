import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../provider-config'
import { TIMEOUTS } from './timeout'
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
  parseSttAudioDurationMs,
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
  it('maps the console API key onto the X-Api-* handshake headers + Upgrade', () => {
    const headers = buildAuthHeaders(
      { apiKey: 'key-1', resourceId: 'volc.seedasr.sauc.duration' },
      'conn-3'
    )
    // New-console-auth: a single X-Api-Key + resource id + per-connection connect
    // id. No app key / access key pair, no signature header, no secret key.
    expect(headers).toEqual({
      Upgrade: 'websocket',
      'X-Api-Key': 'key-1',
      'X-Api-Resource-Id': 'volc.seedasr.sauc.duration',
      'X-Api-Connect-Id': 'conn-3',
    })
  })

  it('never leaks credentials into a logged value: only the documented keys exist', () => {
    const headers = buildAuthHeaders({ apiKey: 'secret', resourceId: 'r' }, 'q')
    // Guard against an accidental extra field carrying credentials elsewhere.
    expect(Object.keys(headers).sort()).toEqual([
      'Upgrade',
      'X-Api-Connect-Id',
      'X-Api-Key',
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

  it('ASR request frames use the sequence-carrying client dialect (request-side flag pin)', () => {
    // Ground-truth pin: the /api/v3/sauc/bigmodel_async streaming ASR server accepts a
    // sequence-carrying client dialect where the config + non-last audio frames
    // are flagged PositiveSequence (0b0001) and the final audio frame is flagged
    // NegativeWithSequence (0b0011), each carrying a 4-byte sequence field.
    // `0b0001`/`0b0011` are legitimate CLIENT-request flags (positive / negative
    // sequence), NOT server-response-only markers. This is exactly what
    // Volcengine's own first-party client (volcengine/ai-app-lab asr_client.py:
    // config = POS_SEQUENCE + sequence=1) and the sequence-carrying demo
    // (thundersoft-td/mcp-server-speech asr_ws.py: config/audio POS_SEQUENCE,
    // last NEG_WITH_SEQUENCE) send. This test locks the request-side flags so a
    // future "fix" toward a (mistaken) response-only reading of 0b0001/0b0011 is
    // caught here instead of failing the whole stream at deploy time.
    const config = parseFrame(
      buildSttConfigFrame({ uid: 'u', format: 'pcm', sampleRate: 16000, model: 'bigmodel' })
    )
    expect(config.messageType).toBe(MessageType.FullClientRequest)
    expect(config.flags).toBe(MessageFlag.PositiveSequence) // 0b0001, NOT 0b0000
    expect(config.sequence).toBe(1) // sequence field IS present (== 1)

    const mid = parseFrame(buildSttAudioFrame(encoder.encode('aud'), 4, false))
    expect(mid.messageType).toBe(MessageType.AudioOnlyClient)
    expect(mid.flags).toBe(MessageFlag.PositiveSequence) // 0b0001
    expect(mid.sequence).toBe(4) // positive sequence present

    const last = parseFrame(buildSttAudioFrame(encoder.encode('aud'), 4, true))
    expect(last.messageType).toBe(MessageType.AudioOnlyClient)
    expect(last.flags).toBe(MessageFlag.NegativeWithSequence) // 0b0011, the end-data marker
    expect(last.sequence).toBe(-4) // negative sequence present
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

  it('parses audio_info.duration alongside the transcript fields', () => {
    // The example-JSON-only field (doc 6561/1354869): present -> the cumulative
    // recognized duration in milliseconds.
    const frame = parseFrame(
      sttServerFrame({
        result: { text: '你好', utterances: [{ definite: true }] },
        audio_info: { duration: 3696 },
      })
    )
    expect(parseSttAudioDurationMs(frame)).toBe(3696)
    // The transcript parse is unaffected by the extra field.
    expect(parseSttResponse(frame)).toEqual({ text: '你好', isFinal: true })
  })

  it('returns undefined duration when audio_info is absent or malformed (best-effort field)', () => {
    // Absent entirely — the formal field table does not list audio_info, so an
    // absent field is the documented-normal case, not an error.
    expect(
      parseSttAudioDurationMs(parseFrame(sttServerFrame({ result: { text: 'x' } })))
    ).toBeUndefined()
    // Present but non-numeric — ignored, never thrown.
    expect(
      parseSttAudioDurationMs(
        parseFrame(sttServerFrame({ result: { text: 'x' }, audio_info: { duration: 'oops' } }))
      )
    ).toBeUndefined()
    // Error frames are the transcript parser's job — the duration helper is total.
    const errFrame = parseFrame(
      buildSttRequestFrame({
        messageType: MessageType.ErrorResponse,
        flags: MessageFlag.PositiveSequence,
        serialization: Serialization.Json,
        sequence: 1,
        payload: encoder.encode('boom'),
      })
    )
    expect(parseSttAudioDurationMs(errFrame)).toBeUndefined()
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

  it('connection-scoped frame omits the session-id field so declared size == payload', () => {
    // Regression for the live park (Worker 345546ef): the server rejected the TTS
    // request with `declared body size does not match actual body size:
    // expected=0 actual=6`. A connection-scoped event (StartConnection) carries NO
    // session-id field; the previous encoder still wrote a zero-length sessionIdSize
    // (4 bytes of `00`), which the server read as a payload size of 0 while the real
    // `[payloadSize=2][{}]` 6 bytes still followed. The fixed layout is
    // `[header(4)][event(4)][payloadSize(4)][payload]` with NO size field between
    // the event and the payload size.
    const frame = buildTtsStartConnectionFrame()
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    // header(4) + event(4) + payloadSize(4) + payload(2) = 14 bytes, never 18.
    expect(frame.length).toBe(14)
    expect(view.getInt32(4, false)).toBe(TtsEvent.StartConnection) // event at offset 4
    const declaredPayloadSize = view.getInt32(8, false) // payload size directly after event
    const actualPayload = frame.subarray(12)
    expect(declaredPayloadSize).toBe(actualPayload.length) // declared == actual
    expect(decoder.decode(actualPayload)).toBe('{}')
    // The earlier malformed shape would have read 0 here (the zero sessionIdSize).
    expect(declaredPayloadSize).not.toBe(0)
  })

  it('session-scoped frame keeps the session-id field with declared size == payload', () => {
    const payload = encoder.encode('{"k":"v"}')
    const frame = buildTtsEventFrame({
      event: TtsEvent.TaskRequest,
      sessionId: 'sid-7',
      payload,
    })
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    expect(view.getInt32(4, false)).toBe(TtsEvent.TaskRequest) // event
    const sessionIdSize = view.getInt32(8, false)
    expect(sessionIdSize).toBe('sid-7'.length)
    let offset = 12 + sessionIdSize
    const declaredPayloadSize = view.getInt32(offset, false)
    offset += 4
    expect(declaredPayloadSize).toBe(payload.length) // declared == actual
    expect(decoder.decode(frame.subarray(offset))).toBe('{"k":"v"}')
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
      apiKey: 'k',
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

    // Connected to the ASR 2.0 optimized endpoint with the ASR 2.0 resource id.
    expect(calls[0].url).toContain('/sauc/bigmodel_async')
    expect(calls[0].headers['X-Api-Resource-Id']).toBe('volc.seedasr.sauc.duration')

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
      apiKey: 'k',
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
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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
    // streaming ASR endpoint (`/api/v3/sauc/bigmodel_async`) accepts ONLY `bigmodel` as
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
      apiKey: 'k',
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
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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

  it('settles cleanly (benign no-speech) when the socket closes before a final transcript', async () => {
    // The hands-free no-speech reinterpretation: a socket close before any
    // final/definite transcript, with NO error frame, is benign — the player's
    // buffered audio held nothing transcribable (a false-positive VAD trigger).
    // The stream must SETTLE CLEANLY (no throw), yielding only the partial /
    // non-definite chunks that did arrive, so `collectFinalTranscript` returns an
    // empty/partial transcript and the turn is skipped upstream instead of the
    // session being torn down. (Genuine faults — error frame, idle stall — still
    // fail loud; they latch the queue error before this close path.)
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(stt.transcribe(await asyncFrom([encoder.encode('f1')])))

    await new Promise((r) => setTimeout(r, 0))
    // A partial (non-definite) transcript arrives, then the socket closes BEFORE
    // any definite/final result — the benign no-final close.
    socket.emitMessage(
      sttServerFrame({ result: { text: '你', utterances: [{ definite: false }] } })
    )
    socket.emitClose()

    const guard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('transcribe did not settle after an early close')), 50)
    )
    const chunks = await Promise.race([consumed, guard])
    // No throw — the stream ended cleanly with just the non-definite chunk.
    expect(chunks).toEqual([{ text: '你', isFinal: false }])
  })

  it('settles cleanly with no chunks when the socket closes having sent nothing (no speech)', async () => {
    // The pure no-speech case: the server accepts the connection and closes
    // without ever sending a transcript frame. The stream ends as an EMPTY clean
    // stream (no throw), so the upstream transcript is empty and the turn skips.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(stt.transcribe(await asyncFrom([encoder.encode('f1')])))

    await new Promise((r) => setTimeout(r, 0))
    socket.emitClose()

    const guard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('transcribe did not settle after an early close')), 50)
    )
    const chunks = await Promise.race([consumed, guard])
    expect(chunks).toEqual([])
  })

  it('treats a socket close AFTER a final transcript as a clean end-of-stream', async () => {
    // The dual of the premature-close test: once a final/definite transcript has
    // arrived (the normal completion), a subsequent socket close is the expected
    // end-of-stream and must NOT fail the already-completed stream. Guards against
    // the fail-loud fix over-firing on the normal path.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const collected = collect(stt.transcribe(await asyncFrom([encoder.encode('f1')])))

    await new Promise((r) => setTimeout(r, 0))
    socket.emitMessage(
      sttServerFrame({ result: { text: '你好', utterances: [{ definite: true }] } })
    )
    // A close arriving after the definite transcript is the normal teardown
    // (the adapter itself also closes the socket on a final transcript).
    socket.emitClose()

    const chunks = await collected
    expect(chunks).toEqual([{ text: '你好', isFinal: true }])
  })
})

describe('createVolcengineSpeechProvider.stt — per-connection usage metering', () => {
  it('reports the LAST cumulative audio_info.duration, not the per-response sum (provider-reported)', async () => {
    // The server's duration is CUMULATIVE per connection: each full response
    // carries the total recognized so far. Two responses (1200ms then 3696ms)
    // must settle as 3696 — summing them (4896) would double-count.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const drained = collect(stt.transcribe(await asyncFrom([encoder.encode('f1')])))
    await tick()
    socket.emitMessage(
      sttServerFrame({
        result: { text: '你', utterances: [{ definite: false }] },
        audio_info: { duration: 1200 },
      })
    )
    socket.emitMessage(
      sttServerFrame({
        result: { text: '你好', utterances: [{ definite: true }] },
        audio_info: { duration: 3696 },
      })
    )
    await drained

    expect(stt.lastUsage).toEqual({ durationMs: 3696, source: 'provider-reported' })
  })

  it('falls back to exact bytes-sent conversion when no response carries audio_info (derived-from-bytes)', async () => {
    // No audio_info anywhere (the formal field table does not promise it). The
    // connection sent 8000 + 8000 = 16000 audio payload bytes; at the default
    // PCM16 mono 16kHz byte rate (32000 B/s) that is exactly 500ms.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const drained = collect(
      stt.transcribe(await asyncFrom([new Uint8Array(8000), new Uint8Array(8000)]))
    )
    await tick()
    socket.emitMessage(sttServerFrame({ result: { text: '好', utterances: [{ definite: true }] } }))
    await drained

    expect(stt.lastUsage).toEqual({ durationMs: 500, source: 'derived-from-bytes' })
  })

  it('resets usage per connection — a later no-report stream does not inherit the prior duration', async () => {
    // Connection 1 settles provider-reported; connection 2 gets no audio_info
    // and must settle from ITS OWN bytes, not leak 9999 from the prior stream.
    const socket1 = new MockSocket()
    const sockets = [socket1, new MockSocket()]
    let call = 0
    const connect: WebSocketConnector = async () => sockets[call++]
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const drained1 = collect(stt.transcribe(await asyncFrom([new Uint8Array(64000)])))
    await tick()
    socket1.emitMessage(
      sttServerFrame({
        result: { text: 'one', utterances: [{ definite: true }] },
        audio_info: { duration: 9999 },
      })
    )
    await drained1
    expect(stt.lastUsage).toEqual({ durationMs: 9999, source: 'provider-reported' })

    const drained2 = collect(stt.transcribe(await asyncFrom([new Uint8Array(32000)])))
    await tick()
    sockets[1].emitMessage(
      sttServerFrame({ result: { text: 'two', utterances: [{ definite: true }] } })
    )
    await drained2

    expect(stt.lastUsage).toEqual({ durationMs: 1000, source: 'derived-from-bytes' })
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
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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
    expect(calls[0].headers['X-Api-Resource-Id']).toBe('seed-tts-2.0')

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
      apiKey: 'k',
      ttsModel: 'seed-tts-2.0-standard',
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
    expect(body.req_params.model).toBe('seed-tts-2.0-standard')

    // With no ttsModel configured, the StartSession req_params omits `model`.
    const noModelSocket = new MockSocket()
    const noModel = mockConnector(noModelSocket)
    const plain = createVolcengineSpeechProvider({
      apiKey: 'k',
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

  it("resolveConfig('demo') TTS omits req_params.model — bound by resource id, not a guessed token", async () => {
    // The `demo` config's TTS model is the empty-string sentinel ("use the
    // resource-id default model"). It is threaded into the adapter (factory F-K
    // passthrough), but the adapter omits `req_params.model` from the StartSession
    // frame for an empty model — so the Doubao TTS 2.0 session is bound by the
    // paired resource id (`seed-tts-2.0`) alone, matching Volcengine's
    // first-party clients. This pins the default-omit so a guessed concrete token
    // (a reject / mis-route risk) cannot creep back at the config layer; the exact
    // `req_params.model` wire value is a deploy-time verification item.
    // Doc: https://www.volcengine.com/docs/6561/1329505
    const resolved = resolveConfig('demo')
    expect(resolved.tts.model).toBe('')

    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({
      apiKey: 'k',
      // Exactly what the factory threads through: `resolved.tts.model` ('').
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
      req_params: Record<string, unknown>
    }
    expect(body.req_params.model).toBeUndefined()
    expect('model' in body.req_params).toBe(false)
  })

  it('threads an explicit concrete ttsModel onto the wire (mechanism preserved for deploy-time token)', async () => {
    // The omit-by-default for `demo` does NOT remove the passthrough mechanism:
    // once the concrete `req_params.model` wire value is confirmed at deploy time,
    // setting a non-empty model in `provider-config` must reach the StartSession
    // frame. Use a concrete candidate variant (`seed-tts-2.0-standard`) to prove
    // the threaded non-empty model is attached verbatim.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({
      apiKey: 'k',
      ttsModel: 'seed-tts-2.0-standard',
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
    expect(body.req_params.model).toBe('seed-tts-2.0-standard')
  })

  it('does NOT send StartSession until the server accepts the connection', async () => {
    // Regression for F-G: the previous pump fired StartSession immediately after
    // StartConnection without waiting for ConnectionStarted, racing the server.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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

  it('fails loudly if the socket closes before the session finishes (premature close)', async () => {
    // A socket close before SessionFinished (152) — handshake-period failure or a
    // mid-stream network drop — must REJECT the consumer, not settle it as a clean
    // empty end-of-stream. Otherwise `runTurn`'s TTS extraction would silently
    // settle a turn with text but no audio. The close also rejects the pump's
    // awaited handshake gate so the pump never hangs awaiting a connection frame.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(tts.synthesize(await asyncFrom(['x'])))
    await tick()
    socket.emitClose()

    // Race against a timer so a hang fails the test rather than stalling: the
    // close must surface as a thrown error promptly, not a silent termination.
    const guard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('synthesize did not settle after an early close')), 50)
    )
    await expect(Promise.race([consumed, guard])).rejects.toThrow(/closed before session finished/)
  })

  it('treats a socket close AFTER SessionFinished as a clean end-of-stream', async () => {
    // The dual of the premature-close test: once SessionFinished (152) has been
    // delivered (the normal completion), a subsequent socket close is the expected
    // end-of-stream and must NOT fail the already-completed stream. Guards against
    // the fail-loud fix over-firing on the normal path.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const collected = collect(tts.synthesize(await asyncFrom(['句一'])))

    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('AUDIO'), sessionId))
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))
    // A close arriving after SessionFinished is the normal teardown.
    socket.emitClose()

    const chunks = await collected
    // The audio + final done chunk are intact; the post-completion close is a
    // no-op, not a failure.
    const audio = chunks.filter((c) => !c.done).map((c) => decoder.decode(c.audio))
    expect(audio).toEqual(['AUDIO'])
    expect(chunks[chunks.length - 1].done).toBe(true)
  })

  it('skips empty text pieces (no TaskRequest emitted for them)', async () => {
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

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
    const provider = createVolcengineSpeechProvider({ apiKey: 'k' })
    expect(typeof provider.stt.transcribe).toBe('function')
    expect(typeof provider.tts.synthesize).toBe('function')
  })
})

// --- Resource cleanup on consumer cancellation (iterator.return) -------------

describe('createVolcengineSpeechProvider — cancellation cleanup (iterator.return)', () => {
  it('TTS synthesize: return() closes the outbound socket and stops the pump sending frames', async () => {
    // Resource-leak P2: when a turn exits early (owner `end` / socket close /
    // upstream STT|LLM failure) `runTurn` calls `ttsIterator.return()`. Before the
    // fix the generator unwound but left the outbound Volcengine TTS socket open
    // and the background pump parked on a handshake gate — leaking the connection
    // and possibly continuing to bill the session. The fix wraps `yield* queue` in
    // try/finally so cancellation: (1) closes the socket; (2) aborts the handshake
    // gates so the parked pump unblocks; (3) stops any further outbound frames.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    // Never-ending text source: the synthesis session stays open (the pump parks on
    // a handshake gate), modelling a turn cancelled mid-flight rather than one that
    // completes on its own.
    const neverEndingText: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => {}),
        }
      },
    }
    const iterator = tts.synthesize(neverEndingText)[Symbol.asyncIterator]()

    // Walk the handshake to where the pump is parked awaiting the next text piece /
    // a gate, having produced one audio frame.
    const first = iterator.next()
    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('AUDIO1'), sessionId))
    const firstChunk = await first
    expect(firstChunk.done).toBe(false)
    expect(decoder.decode((firstChunk.value as { audio: Uint8Array }).audio)).toBe('AUDIO1')

    // The socket is open and the pump has not finished the session.
    expect(socket.closed).toBe(false)
    const sentBeforeCancel = socket.sent.length

    // Consumer cancels (mirrors `runTurn`'s `finally`: `ttsIterator.return()`).
    const ret = await iterator.return?.(undefined)
    expect(ret).toEqual({ value: undefined, done: true })

    // (1) The outbound Volcengine TTS socket was deterministically closed.
    expect(socket.closed).toBe(true)

    // (2)+(3) The pump issues no further frames after cancellation — even if late
    // server events arrive, nothing more is sent (the gates were aborted and the
    // `cancelled` guard short-circuits every send).
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))
    await tick()
    await tick()
    expect(socket.sent.length).toBe(sentBeforeCancel)
  })

  it('ASR transcribe: return() closes the outbound socket and stops the pump pushing audio', async () => {
    // ASR dual of the TTS cancellation fix. `collectFinalTranscript` drains the
    // transcript stream; a turn that breaks early (or aborts) calls the iterator's
    // `return()`. Before the fix the generator unwound but left the outbound ASR
    // socket open and the pump parked pulling the next audio frame — leaking the
    // connection and able to keep streaming audio. The fix's try/finally closes the
    // socket, returns the audio iterator (ending the pump loop), and stops sends.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    // Audio source that yields one frame then parks, so the pump is mid-stream
    // (awaiting the next frame) when the consumer cancels. `returned` flips when
    // the adapter's `finally` returns this iterator — proving the upstream audio
    // generator is released, not left dangling.
    let returned = false
    const pausingAudio: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        let sent = false
        return {
          next: () => {
            if (!sent) {
              sent = true
              return Promise.resolve({ value: encoder.encode('f1'), done: false })
            }
            return new Promise<IteratorResult<Uint8Array>>(() => {})
          },
          return: () => {
            returned = true
            return Promise.resolve({ value: undefined, done: true })
          },
        }
      },
    }

    const iterator = stt.transcribe(pausingAudio)[Symbol.asyncIterator]()

    // Start the iteration and let the pump send the config frame + the first audio
    // frame, then emit a non-final transcript so the consumer receives one chunk.
    const first = iterator.next()
    await tick()
    socket.emitMessage(
      sttServerFrame({ result: { text: '你', utterances: [{ definite: false }] } })
    )
    const firstChunk = await first
    expect(firstChunk.value).toEqual({ text: '你', isFinal: false })

    // The socket is still open mid-stream and the pump is parked awaiting the next
    // audio frame (no final transcript yet).
    expect(socket.closed).toBe(false)
    const sentBeforeCancel = socket.sent.length

    // Consumer cancels mid-stream (the `collectFinalTranscript`-break path).
    const ret = await iterator.return?.(undefined)
    expect(ret).toEqual({ value: undefined, done: true })

    // The outbound ASR socket was deterministically closed and the upstream audio
    // generator was released (its `return` ran).
    expect(socket.closed).toBe(true)
    expect(returned).toBe(true)

    // No further audio frames are sent after cancellation — the pump stopped.
    await tick()
    await tick()
    expect(socket.sent.length).toBe(sentBeforeCancel)
  })

  it('TTS normal completion still closes via SessionFinished — the finally does not regress it', async () => {
    // Guard: the cancellation `finally` must not break the normal-completion path.
    // A run that reaches SessionFinished ends with the final done chunk intact and
    // the full outbound event sequence unchanged (StartConnection -> StartSession
    // -> TaskRequest -> FinishSession -> FinishConnection).
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const collected = collect(tts.synthesize(await asyncFrom(['句一'])))

    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await tick()
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await tick()
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('AUDIO'), sessionId))
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))

    const chunks = await collected
    const audio = chunks.filter((c) => !c.done).map((c) => decoder.decode(c.audio))
    expect(audio).toEqual(['AUDIO'])
    expect(chunks[chunks.length - 1].done).toBe(true)
    // The full outbound event sequence is unchanged by the cleanup finally.
    expect(sentEvents(socket)).toEqual([
      TtsEvent.StartConnection,
      TtsEvent.StartSession,
      TtsEvent.TaskRequest,
      TtsEvent.FinishSession,
      TtsEvent.FinishConnection,
    ])
  })

  it('TTS premature-close fail-loud is not reverted by the cleanup finally', async () => {
    // Guard: a socket close before SessionFinished still rejects the consumer (the
    // earlier premature-close fix), and the cleanup finally on that error unwind
    // does not swallow the rejection.
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(tts.synthesize(await asyncFrom(['x'])))
    await tick()
    socket.emitClose()

    const guard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('synthesize did not settle after an early close')), 50)
    )
    await expect(Promise.race([consumed, guard])).rejects.toThrow(/closed before session finished/)
  })

  it('ASR error-frame fail-loud is not reverted by the cleanup finally', async () => {
    // ASR guard dual: a genuine fault (an ASR error frame) still rejects the
    // consumer; the cleanup finally on the error unwind does not mask it. (A bare
    // no-final close is now benign — covered separately — so the genuine-fault
    // case here is the error frame, which latches the queue error.)
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(stt.transcribe(await asyncFrom([encoder.encode('f1')])))

    await tick()
    const errFrame = buildSttRequestFrame({
      messageType: MessageType.ErrorResponse,
      flags: MessageFlag.PositiveSequence,
      serialization: Serialization.Json,
      sequence: 1,
      payload: encoder.encode('auth failed'),
    })
    socket.emitMessage(errFrame)
    // A close follows the error frame (the adapter closes the socket on unwind).
    // The cleanup finally's queue.close() must NOT mask the latched error.
    socket.emitClose()

    const guard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('transcribe did not settle after an error frame')), 50)
    )
    await expect(Promise.race([consumed, guard])).rejects.toThrow(/Volcengine ASR error/)
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
    // Include `status` + `headers` so the connector's upgrade-observability log
    // (HTTP status + X-Tt-Logid) reads a faithful Response stand-in, exactly as a
    // real Cloudflare 101 upgrade response carries them.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({ webSocket: socket, status: 101, headers: new Headers() }) as unknown as Response
      )
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
        // `status` + `headers` so the connector's upgrade-observability log reads a
        // faithful Response stand-in (a real 101 upgrade response carries them).
        return {
          webSocket: new AcceptableSocket(),
          status: 101,
          headers: new Headers(),
        } as unknown as Response
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

    await defaultConnect('ws://example.test:8080/v3/sauc/bigmodel_async?a=b', {
      Upgrade: 'websocket',
    })

    expect(captured.calls).toHaveLength(1)
    expect(captured.calls[0].url).toBe('http://example.test:8080/v3/sauc/bigmodel_async?a=b')
  })

  it('passes the Upgrade + auth headers through unchanged after the rewrite', async () => {
    const captured = captureFetchUrl()
    const headers = {
      Upgrade: 'websocket',
      'X-Api-Key': 'key-123',
      'X-Api-Resource-Id': 'volc.seedasr.sauc.duration',
      'X-Api-Connect-Id': 'connect-789',
    }

    await defaultConnect('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', headers)

    expect(captured.calls[0].url.startsWith('https://')).toBe(true)
    expect(captured.calls[0].init?.headers).toEqual(headers)
  })
})

// --- Connect / first-response timeouts (hung-fetch / hung-gate fail-loud) ----

describe('defaultConnect — WebSocket upgrade connect timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts a hung upgrade fetch after the connect deadline and throws', async () => {
    // Models a server that accepts the TCP/TLS connection but never returns the
    // 101 upgrade: the upgrade `fetch` hangs until its AbortSignal aborts. The
    // connect deadline must abort it so the turn fails loud instead of parking.
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const connecting = defaultConnect('wss://example.test/v3', { Upgrade: 'websocket' })
    const assertion = expect(connecting).rejects.toThrow(/WebSocket upgrade timed out/)
    await vi.advanceTimersByTimeAsync(TIMEOUTS.connectMs)
    await assertion
    // The signal was actually threaded into the upgrade fetch.
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('createVolcengineSpeechProvider.tts.synthesize — handshake first-response timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails loud when the server never sends ConnectionStarted (hung gate)', async () => {
    // The server accepts the upgrade but never acknowledges StartConnection. The
    // pump's `await handshake.connectionStarted` would park forever; the
    // first-response deadline must abort the handshake so the consumer throws.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(tts.synthesize(asyncFromSync(['x'])))
    const assertion = expect(consumed).rejects.toThrow(/no ConnectionStarted within/)
    // Let the pump send StartConnection and park on the gate.
    await vi.advanceTimersByTimeAsync(0)
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection])
    // No server event arrives — the first-response deadline fires.
    await vi.advanceTimersByTimeAsync(TIMEOUTS.firstResponseMs)
    await assertion
    // The pump never advanced past StartConnection.
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection])
  })

  it('fails loud when the server never sends SessionStarted (hung gate)', async () => {
    // The connection is accepted but the session never is. The pump parks on
    // `await handshake.sessionStarted`; the first-response deadline must abort it.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(tts.synthesize(asyncFromSync(['x'])))
    const assertion = expect(consumed).rejects.toThrow(/no SessionStarted within/)
    await vi.advanceTimersByTimeAsync(0)
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await vi.advanceTimersByTimeAsync(0)
    // Now parked on the session gate with no SessionStarted forthcoming.
    expect(sentEvents(socket)).toEqual([TtsEvent.StartConnection, TtsEvent.StartSession])
    await vi.advanceTimersByTimeAsync(TIMEOUTS.firstResponseMs)
    await assertion
    // The pump never reached TaskRequest.
    expect(sentEvents(socket)).not.toContain(TtsEvent.TaskRequest)
  })

  it('does NOT bound the close-side: a long-but-live synthesis stream is not killed (gaps under the idle bound)', async () => {
    // Once both opening gates are acknowledged, the session may legitimately stay
    // open far longer than firstResponseMs while the server streams audio. The
    // close-side `sessionFinished` gate is intentionally NOT deadlined, and the
    // inter-chunk idle guard measures only the GAP between audio chunks (reset on
    // each), never total duration. So a stream whose total span exceeds
    // firstResponseMs completes normally SO LONG AS each gap stays under
    // streamIdleMs — here two ~15s gaps sum past firstResponseMs yet neither trips
    // the idle guard. Bounding total duration would be a whole-turn timeout, which
    // this fix avoids.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const collected = collect(tts.synthesize(asyncFromSync(['念完整一段话'])))
    await vi.advanceTimersByTimeAsync(0)
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await vi.advanceTimersByTimeAsync(0)
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await vi.advanceTimersByTimeAsync(0)

    // Stream audio across a total span LONGER than firstResponseMs, but with each
    // inter-chunk gap UNDER streamIdleMs so the idle guard keeps resetting.
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('A1'), sessionId))
    await vi.advanceTimersByTimeAsync(TIMEOUTS.streamIdleMs - 5_000)
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('A2'), sessionId))
    await vi.advanceTimersByTimeAsync(TIMEOUTS.streamIdleMs - 5_000)
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('A3'), sessionId))
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))

    const chunks = await collected
    const audio = chunks.filter((c) => !c.done).map((c) => decoder.decode(c.audio))
    expect(audio).toEqual(['A1', 'A2', 'A3'])
    expect(chunks[chunks.length - 1].done).toBe(true)
  })

  it('fails loud when the audio stream goes idle mid-synthesis after a first chunk', async () => {
    // The inter-chunk idle guard for the audio-streaming phase: after the opening
    // handshake and a first audio chunk, a server that falls silent — no further
    // audio, no SessionFinished, never closing — would park `yield* queue` forever
    // (the close-side gate is intentionally unbounded). After streamIdleMs of
    // silence the guard aborts the handshake, fails the queue + closes the socket so
    // the consumer throws (fail loud) instead of the turn hanging to the platform cap.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(tts.synthesize(asyncFromSync(['念完整一段话'])))
    const assertion = expect(consumed).rejects.toThrow(/audio stream idle for >.*during synthesis/)
    await vi.advanceTimersByTimeAsync(0)
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await vi.advanceTimersByTimeAsync(0)
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await vi.advanceTimersByTimeAsync(0)

    // First audio chunk lands — arms the inter-chunk idle guard.
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('A1'), sessionId))
    // Then the server goes silent past streamIdleMs — the idle guard fires.
    await vi.advanceTimersByTimeAsync(TIMEOUTS.streamIdleMs)
    await assertion
    // The idle guard's fail path also closes the outbound socket.
    expect(socket.closed).toBe(true)
  })

  it('fails loud when the handshake completes but the server produces NO audio and NO SessionFinished', async () => {
    // The handshake gates (ConnectionStarted / SessionStarted) are first-response-
    // bounded, and the close-side `sessionFinished` gate is intentionally unbounded.
    // That leaves a hang window the per-audio-chunk guard alone does not cover: the
    // session is accepted and FinishSession is sent, but the server then produces
    // neither an audio frame nor SessionFinished. `await handshake.sessionFinished`
    // would park forever. The idle guard, armed when FinishSession is sent (all text
    // already drained, so a slow LLM cannot false-trip it), bounds this gap and fails
    // loud after streamIdleMs.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(tts.synthesize(asyncFromSync(['念完整一段话'])))
    const assertion = expect(consumed).rejects.toThrow(/audio stream idle for >.*during synthesis/)
    await vi.advanceTimersByTimeAsync(0)
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await vi.advanceTimersByTimeAsync(0)
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    // Pump now sends the TaskRequest(s) + FinishSession and arms the idle guard.
    await vi.advanceTimersByTimeAsync(0)
    expect(sentEvents(socket)).toContain(TtsEvent.FinishSession)
    // No audio and no SessionFinished ever arrive — the idle guard fires.
    await vi.advanceTimersByTimeAsync(TIMEOUTS.streamIdleMs)
    await assertion
    expect(socket.closed).toBe(true)
  })

  it('does NOT fire the post-FinishSession idle guard when audio then SessionFinished arrive in time', async () => {
    // Complement to the no-audio hang test: the guard armed at FinishSession must not
    // kill a session that promptly streams its audio and finishes. A first audio
    // chunk and SessionFinished arriving within streamIdleMs complete normally.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { tts } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const collected = collect(tts.synthesize(asyncFromSync(['念完整一段话'])))
    await vi.advanceTimersByTimeAsync(0)
    socket.emitMessage(ttsServerFrame(TtsEvent.ConnectionStarted, encoder.encode('{}')))
    await vi.advanceTimersByTimeAsync(0)
    const sessionId =
      socket.sent.map((b) => parseFrame(b)).find((f) => f.event === TtsEvent.StartSession)
        ?.sessionId ?? 's'
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionStarted, encoder.encode('{}'), sessionId))
    await vi.advanceTimersByTimeAsync(0)

    // Audio arrives a little after FinishSession (under the idle bound), then finish.
    await vi.advanceTimersByTimeAsync(TIMEOUTS.streamIdleMs - 5_000)
    socket.emitMessage(ttsServerFrame(TtsEvent.TtsResponse, encoder.encode('A1'), sessionId))
    socket.emitMessage(ttsServerFrame(TtsEvent.SessionFinished, encoder.encode('{}'), sessionId))

    const chunks = await collected
    const audio = chunks.filter((c) => !c.done).map((c) => decoder.decode(c.audio))
    expect(audio).toEqual(['A1'])
    expect(chunks[chunks.length - 1].done).toBe(true)
  })
})

describe('createVolcengineSpeechProvider.stt.transcribe — first-response timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails loud when the server accepts the connection then sends no transcript', async () => {
    // The server accepts the connection but never returns a first transcript: the
    // ASR queue ends only on a final transcript / error / close, so `yield* queue`
    // would park forever. The first-response deadline must fail the queue + close
    // the socket so `collectFinalTranscript` throws (fail loud), not hang the turn.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(stt.transcribe(asyncFromSync([encoder.encode('f1')])))
    const assertion = expect(consumed).rejects.toThrow(/no transcript within/)
    await vi.advanceTimersByTimeAsync(0)
    // No server frame arrives — the deadline fires, failing the queue.
    await vi.advanceTimersByTimeAsync(TIMEOUTS.firstResponseMs)
    await assertion
    // The deadline's fail path also closes the outbound socket.
    expect(socket.closed).toBe(true)
  })

  it('does NOT kill a long-but-live transcript stream (gaps under the idle bound)', async () => {
    // Neither deadline bounds total stream length: the first-response deadline is
    // cancelled by the first chunk, and the inter-chunk idle deadline only measures
    // the GAP between consecutive transcripts (reset on each). A stream whose total
    // span far exceeds firstResponseMs is fine SO LONG AS each gap stays under
    // streamIdleMs — every transcript resets the idle guard. Here two ~15s gaps sum
    // to ~30s (> firstResponseMs) yet each is < streamIdleMs, so nothing fires.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const drained = collect(stt.transcribe(asyncFromSync([encoder.encode('f1')])))
    await vi.advanceTimersByTimeAsync(0)
    // First (non-final) transcript arrives within the budget — cancels the
    // first-response deadline and arms the inter-chunk idle guard.
    socket.emitMessage(
      sttServerFrame({ result: { text: '你', utterances: [{ definite: false }] } })
    )
    // A pause under streamIdleMs, then another chunk that resets the idle guard.
    await vi.advanceTimersByTimeAsync(TIMEOUTS.streamIdleMs - 5_000)
    socket.emitMessage(
      sttServerFrame({ result: { text: '你好', utterances: [{ definite: false }] } })
    )
    // Another sub-idle pause — total span now exceeds firstResponseMs — then final.
    await vi.advanceTimersByTimeAsync(TIMEOUTS.streamIdleMs - 5_000)
    socket.emitMessage(
      sttServerFrame({ result: { text: '你好吗', utterances: [{ definite: true }] } })
    )

    const chunks = await drained
    expect(chunks).toEqual([
      { text: '你', isFinal: false },
      { text: '你好', isFinal: false },
      { text: '你好吗', isFinal: true },
    ])
  })

  it('fails loud when the stream goes idle mid-flight after a first transcript', async () => {
    // The inter-chunk idle guard: once a first transcript lands (first-response
    // deadline cancelled), a server that then falls silent — no further transcript,
    // no final, never closing the socket — would park `yield* queue` forever. After
    // streamIdleMs of silence the guard fails the queue + closes the socket so the
    // consumer throws (fail loud) instead of the turn hanging to the platform cap.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(stt.transcribe(asyncFromSync([encoder.encode('f1')])))
    const assertion = expect(consumed).rejects.toThrow(/stream idle for >.*after first transcript/)
    await vi.advanceTimersByTimeAsync(0)
    // First (non-final) transcript lands — cancels first-response, arms idle guard.
    socket.emitMessage(
      sttServerFrame({ result: { text: '你', utterances: [{ definite: false }] } })
    )
    // Server goes silent for longer than streamIdleMs — the idle guard fires.
    await vi.advanceTimersByTimeAsync(TIMEOUTS.streamIdleMs)
    await assertion
    // The idle guard's fail path also closes the outbound socket.
    expect(socket.closed).toBe(true)
  })

  it('does NOT fire the idle guard before the first transcript (that window is the first-response deadline)', async () => {
    // Belt-and-braces: the idle guard arms only once a first transcript has landed.
    // Before that, the (separate) first-response deadline owns the bound. A connect
    // with no transcript must reject as a first-response timeout, never a stream-idle
    // one — confirming the two phases stay distinct.
    vi.useFakeTimers()
    const socket = new MockSocket()
    const { connect } = mockConnector(socket)
    const { stt } = createVolcengineSpeechProvider({ apiKey: 'k', connect })

    const consumed = collect(stt.transcribe(asyncFromSync([encoder.encode('f1')])))
    const assertion = expect(consumed).rejects.toThrow(/no transcript within/)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(TIMEOUTS.firstResponseMs)
    await assertion
    expect(socket.closed).toBe(true)
  })
})
