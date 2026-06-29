/**
 * Volcengine (火山引擎) speech adapter — the shared platform voice layer.
 *
 * One adapter backs BOTH the STT and TTS provider interfaces (see
 * `providers/types.ts`), because the L2 spec models voice as a single shared
 * platform layer rather than one speech vendor per LLM provider.
 *
 *  - STT: Volcengine seedasr / big-model streaming ASR 2.0 over its self-owned
 *    binary WebSocket protocol
 *    (`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`, resource
 *    `volc.seedasr.sauc.duration`). The optimized `_async` endpoint is the one
 *    the ASR 2.0 resource is granted on — the base `/sauc/bigmodel` endpoint
 *    rejects the 2.0 resource with a 400 "not allowed" (verified by live probe
 *    2026-06-25). The first frame is a JSON full-client config request;
 *    subsequent frames are raw audio. Server responses carry a JSON transcript
 *    whose `result.text` is the CUMULATIVE recognized text so far; the FINAL
 *    response (after the client's negative-sequence end-of-audio packet) sets the
 *    "last package" flag bit (`flags & 0x02`) to mark the whole utterance
 *    complete. (`utterances[].definite` marks only a per-segment stabilization
 *    that fires progressively mid-utterance — it is NOT the end-of-utterance.)
 *    This ASR protocol
 *    is *client-push-first by design*: the documented flow is "send full-client
 *    request, then stream audio packets (~100-200ms each)"; there is NO
 *    connection/session-accepted handshake event the client must wait for before
 *    sending audio (unlike the TTS layer below). So sending config-then-audio
 *    without a server "ready" gate is correct here, not optimistic — the server
 *    returns transcripts asynchronously as audio flows. The `_async` optimized
 *    endpoint returns a new full server response ONLY when the result changes
 *    (no longer one response per input audio packet), so the receive loop must
 *    not assume "every input packet yields a response packet" — this adapter's
 *    loop is already response-count-agnostic (it ends on the terminal
 *    last-package transcript, a server error, a socket close, or the
 *    first-response deadline — never on a per-packet response count), so the
 *    optimized cadence needs no adaptation.
 *  - TTS: Doubao TTS 2.0 bidirectional streaming over the event-based binary
 *    protocol (`wss://openspeech.bytedance.com/api/v3/tts/bidirection`,
 *    resource `seed-tts-2.0`). This protocol is *stateful and
 *    server-gated*: the client must wait for the server to accept each step
 *    before advancing — StartConnection -> (await ConnectionStarted, event 50)
 *    -> StartSession -> (await SessionStarted, event 150) -> TaskRequest* ->
 *    FinishSession -> (server streams `TTSResponse` (event 352) audio frames, then
 *    `SessionFinished` (event 152); await SessionFinished) -> FinishConnection.
 *    FinishConnection is gated on SessionFinished — not fired right after
 *    FinishSession — so the tail audio frames are drained before the connection
 *    closes. The handshake gates live in `TtsHandshake` so the timing is
 *    unit-testable with a mock WS.
 *
 * Protocol references (consulted 2026-06):
 *  - ASR binary protocol + sequence flags + auth headers:
 *    https://www.volcengine.com/docs/6561/1354869
 *  - TTS 2.0 bidirectional event protocol:
 *    https://www.volcengine.com/docs/6561/1329505
 *
 * Cloudflare Workers runtime note: these v3 endpoints authenticate entirely via
 * custom request headers — a single `X-Api-Key` console API key plus
 * `X-Api-Resource-Id` and a per-connection `X-Api-Connect-Id` UUID — pure
 * token-header auth, no HMAC signature and no secret key (the secret-key
 * signature scheme is the legacy v1/v2 console-auth path this adapter does not
 * use). The new-console-auth `X-Api-Key` replaces the legacy
 * `X-Api-App-Key` + `X-Api-Access-Key` pair, which has no Doubao 2.0 speech
 * grant. The bare `new WebSocket(url)` constructor cannot set request headers in
 * Workers, so the connection is opened with
 * `fetch(url, { headers: { Upgrade: 'websocket', ... } })` and the socket is
 * taken from `response.webSocket`, set to `binaryType = 'arraybuffer'`, and then
 * `.accept()`ed — so inbound ASR/TTS binary frames arrive as `ArrayBuffer` (what
 * the synchronous `toBytes` codec needs) rather than the post-2026 `Blob`
 * default. Credentials come only from server-side env and are never sent to the
 * client.
 *
 * The wire codec (frame build / frame parse / auth header assembly) is factored
 * into the pure functions below so it is unit-testable without a live network;
 * real Volcengine connectivity under the Workers runtime is a deploy-time
 * open question (see the package README / task open questions).
 */

import type { AudioChunk } from '../contract'
import type { SttProvider, SttTranscriptChunk, SttUsage, TtsAudioChunk, TtsProvider } from './types'
import { awaitWithTimeout, startDeadline, TIMEOUTS, type Deadline } from './timeout'
import { traceTurn, traceTurnError } from '../trace'

// --- Public options ---

/**
 * Credentials + tuning for the Volcengine speech adapter. All credentials are
 * server-side env values; never hard-code them and never forward them to a
 * browser client.
 */
export interface VolcengineSpeechOptions {
  /**
   * Volcengine console API key, sent as the single `X-Api-Key` header. This is
   * the new-console-auth credential that grants the Doubao 2.0 speech stack
   * (seedasr ASR + Doubao TTS 2.0). It replaces the legacy
   * `X-Api-App-Key` + `X-Api-Access-Key` pair, which has no ASR 2.0 grant.
   */
  apiKey: string
  /**
   * Resource id for the ASR endpoint (`X-Api-Resource-Id`). Defaults to
   * `volc.seedasr.sauc.duration` (duration-billed seedasr / big-model ASR 2.0).
   */
  sttResourceId?: string
  /**
   * Resource id for the TTS endpoint (`X-Api-Resource-Id`). Defaults to
   * `seed-tts-2.0` (Doubao 语音合成大模型 2.0 bidirectional streaming). The
   * legacy `volc.service_type.10029` resource was retired by Volcengine and now
   * yields a 403 `requested resource not granted` (verified at deploy time on
   * 2026-06-25); `seed-tts-2.0` is the current granted value (sibling
   * `seed-icl-2.0` selects voice cloning 2.0).
   */
  ttsResourceId?: string
  /** ASR model name in the config request (`request.model_name`). */
  sttModel?: string
  /**
   * TTS model id, attached as the Doubao TTS 2.0 `StartSession`
   * `req_params.model` ONLY when it is a non-empty concrete value. By default the
   * field is OMITTED: the TTS model is bound by the paired endpoint resource id
   * (`X-Api-Resource-Id`, default `seed-tts-2.0`), exactly as Volcengine's own
   * first-party speech clients drive it (they omit `req_params.model` and let the
   * resource id select the model). With `req_params.model` omitted the server
   * defaults to `seed-tts-2.0-standard` (the other concrete value is
   * `seed-tts-2.0-expressive`). Both `undefined` and `''` mean "omit" — `''` is
   * the `provider-config` sentinel for "use the resource-id default model", so the
   * default request shape carries no model token. The factory threads the resolved
   * config model here (F-K), so setting a non-empty `model`
   * (`seed-tts-2.0-standard` / `-expressive`) in `provider-config` reaches the wire
   * through this same passthrough; the resource id is the real knob and omitting
   * `model` already selects the standard model, so a concrete token is only needed
   * to opt into `-expressive`. The deploy-time TTS validation (the resource-id 403)
   * was resolved on 2026-06-25 by switching the resource id to `seed-tts-2.0`.
   */
  ttsModel?: string
  /** TTS speaker / voice type (`req_params.speaker`). */
  ttsSpeaker?: string
  /** Audio sample rate in Hz used on both the ASR input and TTS output. */
  sampleRate?: number
  /**
   * WebSocket connector seam. Defaults to the Cloudflare Workers
   * `fetch(..., { headers: { Upgrade: 'websocket' } })` upgrade pattern. Tests
   * inject a mock here to drive the streaming logic without a live network.
   */
  connect?: WebSocketConnector
}

/**
 * Minimal structural view of a WebSocket the adapter drives. Matches the shape
 * of both the Workers runtime socket and the `MessageEvent`-style mock used in
 * tests; intentionally narrower than the DOM `WebSocket` lib type so the codec
 * stays runtime-agnostic.
 */
export interface AdapterSocket {
  send(data: ArrayBuffer | ArrayBufferView): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(
    type: 'close',
    listener: (event?: { code?: number; reason?: string }) => void
  ): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
}

/** Opens an authenticated WebSocket to `url` with the given request headers. */
export type WebSocketConnector = (
  url: string,
  headers: Record<string, string>
) => Promise<AdapterSocket>

// --- Endpoints + protocol constants ---

const STT_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'
const TTS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection'
const DEFAULT_STT_RESOURCE_ID = 'volc.seedasr.sauc.duration'
const DEFAULT_TTS_RESOURCE_ID = 'seed-tts-2.0'
const DEFAULT_STT_MODEL = 'bigmodel'
// seed-tts-2.0 voice (the `_uranus_` series). The legacy `_mars_` voices
// (e.g. `zh_female_cancan_mars_bigtts`) are seed-tts-1.0 and are rejected by the
// `seed-tts-2.0` resource with "resource ID is mismatched with speaker related
// resource"; 2.0 voices use the `_uranus_` infix.
const DEFAULT_TTS_SPEAKER = 'zh_female_vv_uranus_bigtts'
const DEFAULT_SAMPLE_RATE = 16000

/** byte0: (protocol version 0b0001 << 4) | (header size 0b0001 = 4 bytes). */
const PROTOCOL_HEADER_BYTE0 = 0x11

/** Message types (high nibble of byte 1). */
export const MessageType = {
  FullClientRequest: 0b0001,
  AudioOnlyClient: 0b0010,
  FullServerResponse: 0b1001,
  AudioOnlyServer: 0b1011,
  ErrorResponse: 0b1111,
} as const

/** Message-type-specific flags (low nibble of byte 1). */
export const MessageFlag = {
  NoSequence: 0b0000,
  PositiveSequence: 0b0001,
  LastNoSequence: 0b0010,
  NegativeWithSequence: 0b0011,
  /** TTS event-protocol marker: the frame carries an event int + session id. */
  WithEvent: 0b0100,
} as const

/** Serialization method (high nibble of byte 2). */
export const Serialization = {
  None: 0b0000,
  Json: 0b0001,
} as const

/** Compression method (low nibble of byte 2). No gzip — keeps the codec pure. */
export const Compression = {
  None: 0b0000,
  Gzip: 0b0001,
} as const

/** TTS 2.0 bidirectional event codes. */
export const TtsEvent = {
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  StartSession: 100,
  FinishSession: 102,
  SessionStarted: 150,
  SessionFinished: 152,
  SessionFailed: 153,
  TaskRequest: 200,
  SentenceStart: 350,
  SentenceEnd: 351,
  TtsResponse: 352,
} as const

/**
 * TTS event codes that are CONNECTION-scoped rather than SESSION-scoped. On the
 * wire a connection-scoped event frame carries NO session-id field at all (not
 * even a zero-length size prefix): its layout is `[header][event][payloadSize][payload]`.
 * Session-scoped events insert `[sessionIdSize][sessionId]` between the event and
 * the payload size. The server keys this distinction off the event number, so the
 * client MUST match it: emitting a zero `sessionIdSize` for a connection-scoped
 * event makes the server read that zero as the payload size (declared body = 0)
 * while the real `[payloadSize][payload]` bytes still follow, which it rejects with
 * `declared body size does not match actual body size: expected=0 actual=N`.
 * Both build and parse share this set so the framing stays symmetric.
 */
const CONNECTION_SCOPED_TTS_EVENTS: ReadonlySet<number> = new Set<number>([
  TtsEvent.StartConnection,
  TtsEvent.FinishConnection,
  TtsEvent.ConnectionStarted,
  TtsEvent.ConnectionFailed,
])

function isConnectionScopedTtsEvent(event: number): boolean {
  return CONNECTION_SCOPED_TTS_EVENTS.has(event)
}

// --- Pure codec: frame build / parse / auth headers ---

/** Parsed view of a Volcengine binary frame. */
export interface ParsedFrame {
  messageType: number
  flags: number
  serialization: number
  compression: number
  /** Sequence number, when the flags indicate one is present (ASR). */
  sequence?: number
  /** Event code, when the WithEvent flag is set (TTS). */
  event?: number
  /** Session id, when present on an event frame (TTS). */
  sessionId?: string
  /** Raw payload bytes (after any size field). */
  payload: Uint8Array
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/**
 * Assemble the WebSocket-handshake auth headers. Both the seedasr ASR 2.0 and
 * the Doubao TTS 2.0 endpoints authenticate via the same `X-Api-*` header set;
 * `resourceId` selects the endpoint. `Upgrade: websocket` is required so the
 * Workers `fetch` performs the upgrade (the bare `WebSocket` constructor cannot
 * carry these custom headers).
 *
 * The v3 streaming endpoints use pure token-header auth — no HMAC signature, no
 * secret key. New-console-auth uses a SINGLE `X-Api-Key` credential (verified by
 * live WS-upgrade probe 2026-06-25: `X-Api-Key` alone returns 101 on both the
 * seedasr ASR 2.0 and Doubao TTS 2.0 endpoints; the legacy
 * `X-Api-App-Key` + `X-Api-Access-Key` pair has no ASR 2.0 grant). The headers
 * are: `X-Api-Key` (console API key), `X-Api-Resource-Id` (endpoint selector),
 * and `X-Api-Connect-Id` (a per-connection UUID for handshake-level connection
 * tracing — NOT the business `X-Api-Request-Id`, which is the per-request id used
 * by the HTTP/recording-file APIs, not by this WS handshake).
 */
export function buildAuthHeaders(
  opts: { apiKey: string; resourceId: string },
  connectId: string
): Record<string, string> {
  return {
    Upgrade: 'websocket',
    'X-Api-Key': opts.apiKey,
    'X-Api-Resource-Id': opts.resourceId,
    'X-Api-Connect-Id': connectId,
  }
}

function buildHeader(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number
): Uint8Array {
  return new Uint8Array([
    PROTOCOL_HEADER_BYTE0,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ])
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Encode a signed 32-bit big-endian integer (used for sequence + sizes). */
function int32BE(value: number): Uint8Array {
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setInt32(0, value, false)
  return buf
}

/**
 * Build an ASR client frame: `[header][seq?][payloadSize][payload]`.
 *
 * The first config request is a JSON full-client request with a positive
 * sequence; audio frames are raw audio-only requests. The final audio frame
 * carries a negative sequence with the `NegativeWithSequence` flag so the
 * server knows the stream is complete.
 *
 * Request-frame flag basis (verified against production clients, 2026-06):
 * the `/api/v3/sauc/bigmodel_async` streaming ASR server accepts two equivalent
 * client dialects — one that omits sequence numbers (audio frames flagged
 * `NoSequence` 0b0000) and one that carries them (config + audio flagged
 * `PositiveSequence` 0b0001, the final audio frame flagged
 * `NegativeWithSequence` 0b0011 with a negative sequence). This adapter
 * implements the SEQUENCE-CARRYING dialect consistently across the config,
 * audio, and final frames. `0b0001`/`0b0011` are legitimate client-request
 * flags (positive / negative sequence), NOT server-response-only markers — the
 * server's frame parser keys "sequence present" off `flags & 0x01` and "last
 * package" off `flags & 0x02` symmetrically for requests and responses. The
 * config frame is sent as `FullClientRequest` + `PositiveSequence` + sequence=1,
 * which matches Volcengine's own first-party client exactly.
 * Ground truth:
 *  - volcengine/ai-app-lab arkitect/core/component/asr/asr_client.py
 *    (first-party, Apache-licensed): config frame =
 *    `generate_header(message_type_specific_flags=POS_SEQUENCE)` +
 *    `generate_before_payload(sequence=1)`.
 *  - thundersoft-td/mcp-server-speech src/.../asr_ws.py (sequence-carrying
 *    dialect): config = POS_SEQUENCE + seq; audio non-last = POS_SEQUENCE + seq;
 *    audio last = NEG_WITH_SEQUENCE + negative seq; with the constant comments
 *    `POS_SEQUENCE = 0b0001  # Positive sequence number` and
 *    `NEG_WITH_SEQUENCE = 0b0011  # Negative sequence number (end data frame)`.
 */
export function buildSttRequestFrame(args: {
  messageType: number
  flags: number
  serialization: number
  sequence?: number
  payload: Uint8Array
}): Uint8Array {
  const header = buildHeader(args.messageType, args.flags, args.serialization, Compression.None)
  const parts: Uint8Array[] = [header]
  if (args.sequence !== undefined) {
    parts.push(int32BE(args.sequence))
  }
  parts.push(int32BE(args.payload.length))
  parts.push(args.payload)
  return concatBytes(parts)
}

/** Build the ASR full-client config request frame (sequence 1). */
export function buildSttConfigFrame(config: {
  uid: string
  format: string
  sampleRate: number
  model: string
}): Uint8Array {
  const payload = textEncoder.encode(
    JSON.stringify({
      user: { uid: config.uid },
      audio: {
        format: config.format,
        rate: config.sampleRate,
        bits: 16,
        channel: 1,
      },
      request: {
        model_name: config.model,
        enable_punc: true,
        enable_itn: true,
      },
    })
  )
  return buildSttRequestFrame({
    messageType: MessageType.FullClientRequest,
    flags: MessageFlag.PositiveSequence,
    serialization: Serialization.Json,
    sequence: 1,
    payload,
  })
}

/** Build one ASR audio frame; `isLast` flags the final (negative) packet. */
export function buildSttAudioFrame(
  audio: Uint8Array,
  sequence: number,
  isLast: boolean
): Uint8Array {
  return buildSttRequestFrame({
    messageType: MessageType.AudioOnlyClient,
    flags: isLast ? MessageFlag.NegativeWithSequence : MessageFlag.PositiveSequence,
    serialization: Serialization.None,
    sequence: isLast ? -sequence : sequence,
    payload: audio,
  })
}

/**
 * Build a TTS event frame.
 *
 * Layout depends on the event's scope (see `CONNECTION_SCOPED_TTS_EVENTS`):
 *  - connection-scoped (StartConnection / FinishConnection):
 *    `[header][event][payloadSize][payload]` — NO session-id field at all.
 *  - session-scoped (StartSession / TaskRequest / FinishSession):
 *    `[header][event][sessionIdSize][sessionId][payloadSize][payload]`.
 *
 * Emitting a zero `sessionIdSize` for a connection-scoped event is exactly the
 * bug the server rejects with `declared body size does not match actual body
 * size: expected=0 actual=N` (it reads that zero as the payload size). So the
 * session-id pair is written ONLY for session-scoped events; the declared
 * `payloadSize` always equals the actual payload byte length for every frame.
 */
export function buildTtsEventFrame(args: {
  event: number
  sessionId: string
  payload: Uint8Array
}): Uint8Array {
  const header = buildHeader(
    MessageType.FullClientRequest,
    MessageFlag.WithEvent,
    Serialization.Json,
    Compression.None
  )
  const parts: Uint8Array[] = [header, int32BE(args.event)]
  if (!isConnectionScopedTtsEvent(args.event)) {
    const sessionIdBytes = textEncoder.encode(args.sessionId)
    parts.push(int32BE(sessionIdBytes.length))
    parts.push(sessionIdBytes)
  }
  parts.push(int32BE(args.payload.length))
  parts.push(args.payload)
  return concatBytes(parts)
}

/** Build the TTS StartConnection frame (no session, empty JSON payload). */
export function buildTtsStartConnectionFrame(): Uint8Array {
  return buildTtsEventFrame({
    event: TtsEvent.StartConnection,
    sessionId: '',
    payload: textEncoder.encode('{}'),
  })
}

/** Build the TTS FinishConnection frame. */
export function buildTtsFinishConnectionFrame(): Uint8Array {
  return buildTtsEventFrame({
    event: TtsEvent.FinishConnection,
    sessionId: '',
    payload: textEncoder.encode('{}'),
  })
}

/**
 * Build the TTS StartSession frame carrying the synthesis parameters. `model` is
 * threaded into `req_params` only when it is a non-empty concrete value; both an
 * absent `model` and an empty-string `model` (the `provider-config` "use the
 * resource-id default model" sentinel) omit `req_params.model` entirely, so the
 * default request shape carries no model token and the resource id selects the
 * model — matching Volcengine's first-party clients.
 */
export function buildTtsStartSessionFrame(args: {
  sessionId: string
  speaker: string
  sampleRate: number
  model?: string
}): Uint8Array {
  const reqParams: {
    speaker: string
    audio_params: { format: string; sample_rate: number }
    model?: string
  } = {
    speaker: args.speaker,
    audio_params: {
      format: 'pcm',
      sample_rate: args.sampleRate,
    },
  }
  if (args.model !== undefined && args.model !== '') {
    reqParams.model = args.model
  }
  const payload = textEncoder.encode(
    JSON.stringify({
      event: TtsEvent.StartSession,
      namespace: 'BidirectionalTTS',
      req_params: reqParams,
    })
  )
  return buildTtsEventFrame({
    event: TtsEvent.StartSession,
    sessionId: args.sessionId,
    payload,
  })
}

/** Build a TTS TaskRequest frame feeding one text chunk into the session. */
export function buildTtsTaskRequestFrame(args: {
  sessionId: string
  text: string
  speaker: string
}): Uint8Array {
  const payload = textEncoder.encode(
    JSON.stringify({
      event: TtsEvent.TaskRequest,
      namespace: 'BidirectionalTTS',
      req_params: {
        text: args.text,
        speaker: args.speaker,
      },
    })
  )
  return buildTtsEventFrame({
    event: TtsEvent.TaskRequest,
    sessionId: args.sessionId,
    payload,
  })
}

/** Build the TTS FinishSession frame closing the synthesis session. */
export function buildTtsFinishSessionFrame(sessionId: string): Uint8Array {
  return buildTtsEventFrame({
    event: TtsEvent.FinishSession,
    sessionId,
    payload: textEncoder.encode('{}'),
  })
}

// --- TTS handshake state machine (event-driven, server-gated) ---

/**
 * The Doubao TTS 2.0 bidirectional protocol is **stateful**: the server accepts
 * the connection and the session in two distinct steps, and each must be
 * acknowledged before the next client frame is legal. Sending `StartSession`
 * before the server's `ConnectionStarted`, or `TaskRequest` before its
 * `SessionStarted`, races the server — early frames are rejected/ignored and the
 * turn yields no audio.
 *
 * This pure gate makes that timing explicit and unit-testable without a live
 * socket: the message listener feeds inbound server events via `handleEvent`,
 * and the pump `await`s `connectionStarted` / `sessionStarted` before advancing,
 * then `sessionFinished` before closing the connection. A `ConnectionFailed` /
 * `SessionFailed` event rejects the matching gate so the pump fails loudly
 * instead of hanging.
 *
 * It sequences both ends of the handshake symmetrically: the connection +
 * session acceptance gates open the turn, and the `sessionFinished` gate closes
 * it. `SessionStarted` (150) resolves the start gate; `SessionFinished` (152)
 * resolves the finish gate — gating the client's `FinishConnection` until the
 * server has streamed every remaining `TTSResponse` frame and acknowledged the
 * session is complete, so closing the socket never truncates the tail audio.
 * The audio queue itself (pushing `TTSResponse` frames + the final `done` chunk
 * on `SessionFinished`) stays in the provider's message listener.
 */
export class TtsHandshake {
  /** Resolves when the server has accepted the connection (event 50). */
  readonly connectionStarted: Promise<void>
  /** Resolves when the server has accepted the session (event 150). */
  readonly sessionStarted: Promise<void>
  /**
   * Resolves when the server has finished the session (event 152) — i.e. every
   * remaining `TTSResponse` audio frame has been delivered. The pump awaits this
   * before sending `FinishConnection`, so closing the connection never truncates
   * the tail audio. Symmetric to the start-side `connectionStarted` /
   * `sessionStarted` gates.
   */
  readonly sessionFinished: Promise<void>

  private resolveConnection!: () => void
  private rejectConnection!: (err: unknown) => void
  private resolveSession!: () => void
  private rejectSession!: (err: unknown) => void
  private resolveSessionFinished!: () => void
  private rejectSessionFinished!: (err: unknown) => void
  private connectionSettled = false
  private sessionSettled = false
  private sessionFinishedSettled = false

  constructor() {
    this.connectionStarted = new Promise<void>((resolve, reject) => {
      this.resolveConnection = resolve
      this.rejectConnection = reject
    })
    this.sessionStarted = new Promise<void>((resolve, reject) => {
      this.resolveSession = resolve
      this.rejectSession = reject
    })
    this.sessionFinished = new Promise<void>((resolve, reject) => {
      this.resolveSessionFinished = resolve
      this.rejectSessionFinished = reject
    })
    // A rejected gate the pump has not awaited yet would surface as an unhandled
    // rejection; attach an inert catch so the rejection is delivered only to the
    // awaiting pump, never to the process.
    this.connectionStarted.catch(() => {})
    this.sessionStarted.catch(() => {})
    this.sessionFinished.catch(() => {})
  }

  /**
   * Advance the handshake from one inbound server event. Returns `true` if the
   * event was a handshake-control event this gate consumed (so the caller can
   * skip further handling), `false` for any other event (audio).
   *
   * `SessionFinished` (152) is special: it resolves the finish gate but returns
   * `false`, because the provider's listener still owns pushing the final `done`
   * chunk + closing the audio queue on that same event.
   */
  handleEvent(event: number | undefined, describe: () => string): boolean {
    switch (event) {
      case TtsEvent.ConnectionStarted:
        this.settleConnection()
        return true
      case TtsEvent.ConnectionFailed:
        this.failConnection(new Error(`Volcengine TTS connection failed: ${describe()}`))
        return true
      case TtsEvent.SessionStarted:
        this.settleSession()
        return true
      case TtsEvent.SessionFinished:
        this.settleSessionFinished()
        return false
      default:
        return false
    }
  }

  /** Reject any not-yet-settled gate (e.g. on a socket close before handshake). */
  abort(err: unknown): void {
    this.failConnection(err)
    this.failSession(err)
    this.failSessionFinished(err)
  }

  private settleConnection(): void {
    if (this.connectionSettled) return
    this.connectionSettled = true
    this.resolveConnection()
  }

  private failConnection(err: unknown): void {
    if (this.connectionSettled) return
    this.connectionSettled = true
    this.rejectConnection(err)
  }

  private settleSession(): void {
    if (this.sessionSettled) return
    this.sessionSettled = true
    this.resolveSession()
  }

  private failSession(err: unknown): void {
    if (this.sessionSettled) return
    this.sessionSettled = true
    this.rejectSession(err)
  }

  private settleSessionFinished(): void {
    if (this.sessionFinishedSettled) return
    this.sessionFinishedSettled = true
    this.resolveSessionFinished()
  }

  private failSessionFinished(err: unknown): void {
    if (this.sessionFinishedSettled) return
    this.sessionFinishedSettled = true
    this.rejectSessionFinished(err)
  }
}

/** Coerce any inbound WS message payload to a `Uint8Array` view. */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  if (typeof data === 'string') return textEncoder.encode(data)
  throw new TypeError('unsupported WebSocket message payload')
}

/**
 * Parse a Volcengine binary frame. Handles both shapes: the ASR
 * sequence-carrying frame and the TTS event frame (WithEvent flag). The two
 * are disambiguated by the flags nibble, exactly as the wire encodes them.
 */
export function parseFrame(data: unknown): ParsedFrame {
  const bytes = toBytes(data)
  if (bytes.length < 4) {
    throw new RangeError('frame shorter than 4-byte header')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const messageType = bytes[1] >> 4
  const flags = bytes[1] & 0x0f
  const serialization = bytes[2] >> 4
  const compression = bytes[2] & 0x0f

  let offset = 4
  const frame: ParsedFrame = {
    messageType,
    flags,
    serialization,
    compression,
    payload: new Uint8Array(0),
  }

  if ((flags & MessageFlag.WithEvent) === MessageFlag.WithEvent) {
    // TTS event frame. Connection-scoped events carry no session-id field
    // (`[event][payloadSize][payload]`); session-scoped events insert it
    // (`[event][sessionIdSize][sessionId][payloadSize][payload]`). Symmetric to
    // `buildTtsEventFrame` — both key the session-id field off the event scope.
    frame.event = view.getInt32(offset, false)
    offset += 4
    if (isConnectionScopedTtsEvent(frame.event)) {
      frame.sessionId = ''
    } else {
      const sessionIdSize = view.getInt32(offset, false)
      offset += 4
      frame.sessionId = textDecoder.decode(bytes.subarray(offset, offset + sessionIdSize))
      offset += sessionIdSize
    }
  } else if (flags === MessageFlag.PositiveSequence || flags === MessageFlag.NegativeWithSequence) {
    // ASR sequence-carrying frame: [sequence][payloadSize][payload].
    frame.sequence = view.getInt32(offset, false)
    offset += 4
  }

  const payloadSize = view.getInt32(offset, false)
  offset += 4
  frame.payload = bytes.subarray(offset, offset + payloadSize)
  return frame
}

/**
 * The "last package" bit of the message-type-specific flags nibble. The
 * Volcengine big-model ASR server sets it on the FINAL response — the one that
 * answers the client's negative-sequence end-of-audio packet — to mark the whole
 * utterance complete. It is shared by both wire dialects of a terminal frame:
 * no-sequence (`LastNoSequence` 0b0010) and with-sequence (`NegativeWithSequence`
 * 0b0011) both carry it. Ground truth (first-party + community clients all derive
 * `is_last_package` from `flags & 0x02`): volcengine/ai-app-lab
 * arkitect/core/component/asr/asr_client.py (`ASRFullServerResponse.last_package`),
 * volcengine/veadk-python asr_client.py, and thundersoft-td/mcp-server-speech
 * src/.../asr_ws.py.
 */
const LAST_PACKAGE_FLAG_BIT = 0x02

/** True when the frame's flags carry the "last package" (end-of-utterance) bit. */
export function isLastPackageFlags(flags: number): boolean {
  return (flags & LAST_PACKAGE_FLAG_BIT) !== 0
}

/**
 * Map a parsed ASR server-response frame to a transcript chunk. Returns
 * `undefined` for frames with no transcript text (e.g. an empty ack).
 *
 * `text` is the server's CUMULATIVE recognized text (full-so-far, not a
 * per-segment delta). `isFinal` marks the TERMINAL response — the last-package
 * frame (`flags & 0x02`) the server sends after it has processed the client's
 * end-of-audio packet and produced the complete cumulative result.
 *
 * It is keyed off the last-package flag, NOT `utterances[].definite`: `definite`
 * marks a per-segment stabilization that fires PROGRESSIVELY mid-utterance, so
 * any utterance longer than its first stabilized segment has multiple `definite`
 * results before the end. Ending on the first `definite` truncated the
 * transcript to the opening segment — the bug this fix removes. The genuine
 * end-of-utterance is the last-package response (or, as a fallback, the socket
 * close the server performs right after it — handled by the transcribe loop).
 */
export function parseSttResponse(frame: ParsedFrame): SttTranscriptChunk | undefined {
  if (frame.messageType === MessageType.ErrorResponse) {
    throw new Error(`Volcengine ASR error: ${textDecoder.decode(frame.payload)}`)
  }
  if (frame.serialization !== Serialization.Json || frame.payload.length === 0) {
    return undefined
  }
  const body = JSON.parse(textDecoder.decode(frame.payload)) as {
    result?: { text?: string }
  }
  const result = body.result
  if (!result || typeof result.text !== 'string') {
    return undefined
  }
  return { text: result.text, isFinal: isLastPackageFlags(frame.flags) }
}

/**
 * Extract the cumulative recognized-audio duration (milliseconds) from a full
 * ASR server response, when present.
 *
 * `audio_info.duration` appears in the documented example JSON of the v3
 * big-model ASR response but NOT in its formal field table (doc 6561/1354869),
 * so it is treated as best-effort by design: parse it when present
 * (`provider-reported` metering) and fall back to an exact byte-rate conversion
 * when absent (`derived-from-bytes`). Semantics are CUMULATIVE per connection —
 * each response carries the total recognized duration so far, so the LAST
 * value (never the sum across responses) is the connection's consumption.
 *
 * Pure and total: returns `undefined` for non-JSON frames, error frames,
 * empty payloads, malformed JSON, or a missing/non-numeric field — it never
 * throws (transcript-side errors are `parseSttResponse`'s job).
 */
export function parseSttAudioDurationMs(frame: ParsedFrame): number | undefined {
  if (frame.messageType !== MessageType.FullServerResponse) return undefined
  if (frame.serialization !== Serialization.Json || frame.payload.length === 0) return undefined
  let body: { audio_info?: { duration?: unknown } }
  try {
    body = JSON.parse(textDecoder.decode(frame.payload)) as {
      audio_info?: { duration?: unknown }
    }
  } catch {
    return undefined
  }
  const duration = body.audio_info?.duration
  return typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined
}

// --- Default Workers connector ---

/**
 * Rewrite a WebSocket URL scheme to its HTTP equivalent for the `fetch`-upgrade
 * path: `wss:` -> `https:`, `ws:` -> `http:`. The endpoint constants stay
 * `wss://` (the adapter's outward contract is WebSocket), but the Cloudflare
 * Workers custom-header upgrade pattern requires an `http(s)://` URL handed to
 * `fetch`: `ws:`/`wss:` are reserved for the `new WebSocket()` constructor,
 * which cannot carry the `X-Api-*` auth headers. With the
 * `fetch_refuses_unknown_protocols` runtime behavior a `wss://` URL is no longer
 * silently coerced to HTTP, so passing it straight to `fetch` fails the upgrade
 * before any turn starts. Only the leading scheme is touched — host, path, and
 * query are untouched. (Cloudflare docs: workers/examples/websockets +
 * configuration/compatibility-flags#fetch-refuses-unknown-protocols.)
 */
function toFetchUpgradeUrl(url: string): string {
  if (url.startsWith('wss:')) return `https:${url.slice('wss:'.length)}`
  if (url.startsWith('ws:')) return `http:${url.slice('ws:'.length)}`
  return url
}

/**
 * Open an authenticated outbound WebSocket from a Cloudflare Worker. Uses the
 * `fetch` + `Upgrade: websocket` pattern because the bare `WebSocket`
 * constructor cannot attach the `X-Api-*` auth headers in the Workers runtime.
 * The `wss://` endpoint constant is rewritten to `https://` via
 * `toFetchUpgradeUrl` before `fetch`, as the Workers upgrade path requires an
 * `http(s)://` URL (see that helper).
 */
export const defaultConnect: WebSocketConnector = async (url, headers) => {
  // Connect timeout: the WebSocket upgrade `fetch` can hang indefinitely during
  // the handshake (the server accepts the TCP/TLS connection but never returns
  // the 101 upgrade), with no error raised — parking the turn's first provider
  // `await` forever. An `AbortController` + connect deadline bounds that window:
  // a stalled upgrade aborts, `fetch` rejects, and the turn fails loud instead of
  // hanging. The deadline is cleared the instant `fetch` resolves; the streaming
  // that follows on the socket is driven by the per-frame listeners, not here.
  const connectController = new AbortController()
  const connectDeadline = startDeadline(TIMEOUTS.connectMs, () =>
    connectController.abort(
      new Error(`Volcengine WebSocket upgrade timed out after ${TIMEOUTS.connectMs}ms`)
    )
  )
  let response: Response
  try {
    response = await fetch(toFetchUpgradeUrl(url), { headers, signal: connectController.signal })
  } finally {
    connectDeadline.cancel()
  }
  // Observability: surface the Volcengine handshake verdict (HTTP status + the
  // `X-Tt-Logid` trace id Volcengine support keys their server logs off) that
  // the `fetch`-upgrade response carries before the socket is taken. Resource id
  // distinguishes ASR vs TTS upgrades in the trace. Emitted as a `turn-trace`
  // line so it shares the one greppable format (see `trace.ts`).
  traceTurn('ws', 'upgrade', {
    resource: headers['X-Api-Resource-Id'],
    status: response.status,
    logid: response.headers.get('X-Tt-Logid') ?? response.headers.get('x-tt-logid') ?? '<none>',
  })
  // Cloudflare's fetch exposes the negotiated socket on the response.
  const socket = (
    response as unknown as {
      webSocket?: AdapterSocket & { accept(): void; binaryType: 'blob' | 'arraybuffer' }
    }
  ).webSocket
  if (!socket) {
    throw new Error('Volcengine WebSocket upgrade failed: no webSocket on response')
  }
  // Opt back into ArrayBuffer delivery BEFORE accepting. With this Worker's
  // `compatibility_date` (2026-06-08) the `websocket_standard_binary_type`
  // default delivers inbound binary WS frames as `Blob`. The ASR/TTS message
  // listeners parse every frame synchronously via `parseFrame` -> `toBytes`,
  // which accepts ArrayBuffer / typed-array views / strings but NOT a `Blob`
  // (a Blob can only be read async via `blob.arrayBuffer()`). A Blob would hit
  // `toBytes`'s `unsupported WebSocket message payload` throw and fail the turn.
  // Setting `binaryType` keeps the synchronous codec path correct. MUST precede
  // `accept()` — the runtime only honors it before the socket is accepted.
  // (Cloudflare docs: runtime-apis/websockets#binary-messages.) Applies to BOTH
  // outbound connections (ASR + TTS) since both open through this one connector.
  socket.binaryType = 'arraybuffer'
  socket.accept()
  return socket
}

// --- Streaming glue: an async queue bridging WS events to async iteration ---

/**
 * Minimal single-consumer async queue. Inbound WS messages are pushed in via
 * `push`; the consumer pulls them with `for await`. `close` ends iteration,
 * `fail` rejects the pending pull.
 */
class AsyncQueue<T> {
  private values: T[] = []
  private resolvers: Array<(r: IteratorResult<T>) => void> = []
  private rejecters: Array<(e: unknown) => void> = []
  private closed = false
  private error: unknown

  push(value: T): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) {
      this.rejecters.shift()
      resolve({ value, done: false })
    } else {
      this.values.push(value)
    }
  }

  close(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      this.rejecters.shift()
      this.resolvers.shift()?.({ value: undefined, done: true })
    }
  }

  fail(error: unknown): void {
    this.error = error
    this.closed = true
    while (this.rejecters.length > 0) {
      this.resolvers.shift()
      this.rejecters.shift()?.(error)
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift() as T
        continue
      }
      if (this.error !== undefined) throw this.error
      if (this.closed) return
      const next = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.resolvers.push(resolve)
        this.rejecters.push(reject)
      })
      if (next.done) return
      yield next.value
    }
  }
}

// --- Provider factory ---

/**
 * The Volcengine STT slot. Extends `SttProvider` with the optional `lastUsage`
 * metering field (mirrors `DeepSeekLlmProvider.lastUsage`): after each
 * transcribe stream is fully consumed, it carries the connection's audio
 * duration — the server's cumulative `audio_info.duration` report when one
 * arrived (`provider-reported`), else the exact byte-rate conversion of the
 * audio actually sent (`derived-from-bytes`).
 */
export interface VolcengineSttProvider extends SttProvider {
  /** STT usage from the most recently consumed transcribe stream. */
  lastUsage?: SttUsage
}

/**
 * Build the Volcengine speech provider pair. The returned object satisfies both
 * `SttProvider` and `TtsProvider`; the platform wires the same instance into
 * both layer slots (the voice layer is shared, per the L2 spec).
 */
export function createVolcengineSpeechProvider(opts: VolcengineSpeechOptions): {
  stt: VolcengineSttProvider
  tts: TtsProvider
} {
  const connect = opts.connect ?? defaultConnect
  const sttResourceId = opts.sttResourceId ?? DEFAULT_STT_RESOURCE_ID
  const ttsResourceId = opts.ttsResourceId ?? DEFAULT_TTS_RESOURCE_ID
  const sttModel = opts.sttModel ?? DEFAULT_STT_MODEL
  const ttsModel = opts.ttsModel
  const ttsSpeaker = opts.ttsSpeaker ?? DEFAULT_TTS_SPEAKER
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE
  // PCM 16-bit mono: 2 bytes per sample. Exact byte rate for the
  // `derived-from-bytes` fallback conversion below.
  const bytesPerSecond = sampleRate * 2

  const stt: VolcengineSttProvider = {
    async *transcribe(audio: AsyncIterable<AudioChunk>): AsyncIterable<SttTranscriptChunk> {
      // Reset before consuming so a prior connection's usage cannot leak into
      // this one (mirrors the DeepSeek `lastUsage` reset).
      stt.lastUsage = undefined
      const connectId = randomId()
      const asrStart = Date.now()
      const headers = buildAuthHeaders(
        { apiKey: opts.apiKey, resourceId: sttResourceId },
        connectId
      )
      const socket = await connect(STT_URL, headers)
      const queue = new AsyncQueue<SttTranscriptChunk>()
      // Tracks whether the terminal (last-package) transcript arrived — the ASR
      // normal completion signal. Used by the message listener (terminal → close
      // the queue and the socket) and surfaced in the close trace. A socket close
      // is a clean end-of-stream EITHER way now: with a terminal it is the normal
      // teardown; without one (and without a prior error frame) it is a benign
      // no-speech turn the consumer skips (see the close listener). Unlike the
      // TTS layer's SessionFinished gate — a missing AI response is a fault — a
      // missing player transcript is benign, so the ASR close path does NOT fail
      // the queue on a no-final close.
      let finalReached = false
      // Per-connection metering state. `reportedDurationMs` follows the server's
      // cumulative `audio_info.duration` — each response overwrites it, so it
      // ends as the LAST response's value, the connection's total consumption
      // (summing per response would double-count the cumulative figure).
      // `sentAudioBytes` counts the audio payload bytes actually SENT on the
      // wire (config frame excluded) — the exact-conversion fallback source. A
      // cancelled pump stops sending and stops counting, so the fallback can
      // only undercount, never over-meter.
      let reportedDurationMs: number | undefined
      let sentAudioBytes = 0

      // First-response timeout: the ASR queue ends only on a final transcript, a
      // server error, or a socket close — if the server accepts the connection
      // then goes silent (never sends a first transcript), `yield* queue` parks
      // forever and the turn locks up. This deadline bounds the time to the FIRST
      // transcript chunk; on timeout it fails the queue + closes the socket,
      // degrading into the same premature-close fail-loud path a mid-handshake
      // drop already takes. It is cancelled on the first chunk, so a slow first
      // transcript is tolerated and the streaming that follows is unbounded (only
      // the first response is deadlined — never the whole stream).
      const firstResponseDeadline = startDeadline(TIMEOUTS.firstResponseMs, () => {
        traceTurnError('asr', 'first-response-timeout', { ms: TIMEOUTS.firstResponseMs })
        queue.fail(new Error(`Volcengine ASR: no transcript within ${TIMEOUTS.firstResponseMs}ms`))
        socket.close()
      })

      // Inter-chunk idle guard for the streaming phase. `firstResponseDeadline`
      // above bounds only the gap to the FIRST transcript; once streaming, a server
      // that falls silent mid-stream (sends no further transcript, no final, never
      // closes the socket) would park `yield* queue` forever — the same hang the
      // LLM SSE layer guards with `TIMEOUTS.streamIdleMs`. This bounds the silent
      // GAP between consecutive transcripts: (re)armed on each non-final chunk,
      // cancelled the instant the stream ends (final / close / error / generator
      // exit). A live stream keeps resetting it so only a stall trips it — failing
      // the queue loud and closing the socket, the existing premature-close fail
      // path. Volcengine is a push model (AsyncQueue + message listener), so this is
      // a re-armable deadline reset per pushed frame, NOT the SSE per-read race.
      let streamIdleDeadline: Deadline | undefined
      const resetStreamIdle = (): void => {
        streamIdleDeadline?.cancel()
        streamIdleDeadline = startDeadline(TIMEOUTS.streamIdleMs, () => {
          traceTurnError('asr', 'stream-idle-timeout', { ms: TIMEOUTS.streamIdleMs })
          queue.fail(
            new Error(
              `Volcengine ASR: stream idle for >${TIMEOUTS.streamIdleMs}ms after first transcript`
            )
          )
          socket.close()
        })
      }

      socket.addEventListener('message', (event) => {
        try {
          const frame = parseFrame(event.data)
          const duration = parseSttAudioDurationMs(frame)
          if (duration !== undefined) reportedDurationMs = duration
          const chunk = parseSttResponse(frame)
          if (!chunk) return
          // First transcript landed in time — stop the first-response deadline so
          // the rest of the stream runs unbounded.
          firstResponseDeadline.cancel()
          // Every chunk (interim cumulative result + the terminal one) is pushed
          // to the queue, so the consumer streams them as live subtitle updates.
          queue.push(chunk)
          // The TERMINAL (last-package) transcript is the normal completion
          // signal: end the iteration here instead of waiting for a separate WS
          // `close`. Without this, the consumer (which drains `transcribe` to
          // iterator end) would hang the whole turn whenever the server keeps the
          // socket open after the final result. Push the chunk first, then close,
          // so the complete transcript is never dropped. Crucially `chunk.isFinal`
          // now means the last-package response (the whole utterance is done) —
          // NOT a mid-utterance `definite` segment — so a long utterance is no
          // longer truncated at its first stabilized segment. Also close the ASR
          // socket as the normal end-of-stream path (idempotent; mirrors TTS).
          if (chunk.isFinal) {
            finalReached = true
            // ASR terminal/last-package transcript — the normal completion signal
            // (length only, never the text).
            traceTurn('asr', 'final', {
              transcriptChars: chunk.text.length,
              elapsedMs: Date.now() - asrStart,
            })
            // Normal end-of-stream: clear the inter-chunk idle guard so it can never
            // fire late against an already-closed queue.
            streamIdleDeadline?.cancel()
            queue.close()
            socket.close()
          } else {
            // Streaming continues — (re)arm the inter-chunk idle guard for the gap
            // to the next transcript.
            resetStreamIdle()
          }
        } catch (err) {
          // Observability: an error frame (parseSttResponse throws with the
          // server's code/message) or a malformed frame lands here — surface
          // that one occurred (message LENGTH only, never the decoded text)
          // instead of letting it vanish into the generic queue failure.
          // Clear the idle guard first so a stalled deadline never outlives a
          // failed stream.
          streamIdleDeadline?.cancel()
          traceTurnError('asr', 'frame-error', {
            messageChars: (err instanceof Error ? err.message : String(err)).length,
          })
          queue.fail(err)
        }
      })
      // A socket close ends the stream. After the terminal last-package transcript
      // it is the expected end-of-stream; before one (and with no prior error
      // frame) it is a benign no-speech close (see below) — and it also backstops
      // the case where the server closes after the final cumulative result without
      // setting the last-package flag (the consumer then falls back to the last
      // cumulative text). Either way the queue settles cleanly — a genuine fault
      // has already latched the queue error before the close arrives.
      socket.addEventListener('close', (event) => {
        // Observability: the Volcengine ASR close CODE (numeric) + reason LENGTH.
        // A clean 1000/empty close after silence vs a non-1000 protocol close
        // points at very different root causes — the numeric code (with
        // `finalReached`) carries that signal without logging the raw reason text.
        traceTurn('asr', 'socket-close', {
          code: event?.code,
          reasonChars: (event?.reason ?? '').length,
          finalReached,
        })
        // The stream has ended either way — stop the idle guard so it cannot fire
        // late against an already-settled queue.
        streamIdleDeadline?.cancel()
        // Settle the queue CLEANLY whether or not a terminal transcript arrived. A
        // close AFTER the terminal last-package transcript is the normal
        // end-of-stream. A close WITHOUT one and without a prior error frame is a
        // benign no-speech turn: the player's buffered audio held nothing
        // transcribable (a false-positive VAD trigger — a stopwatch tick, a cough,
        // ambient noise), so the server closed without ever sending a terminal
        // result. It must NOT fail the turn — the consumer (`collectFinalTranscript`)
        // surfaces an empty (or partial, non-terminal) transcript and the turn is
        // skipped upstream, keeping the session alive and listening.
        //
        // Genuine faults are unaffected and still fail loud (1008): an error
        // frame (`parseSttResponse` throw), the first-response deadline, and the
        // inter-chunk idle guard each `queue.fail(...)` — latching `queue.error`
        // — BEFORE this close fires. The iterator checks a latched error ahead of
        // a clean close, so this `queue.close()` is a no-op on an already-failed
        // queue and the latched error is what the consumer sees. (A connect
        // failure throws before the queue exists, so it never reaches here.)
        queue.close()
      })
      socket.addEventListener('error', (err) => {
        streamIdleDeadline?.cancel()
        queue.fail(err)
      })

      // Pump audio in the background so we can yield transcripts as they arrive.
      //
      // `cancelled` is set by the generator's `finally` when the consumer calls
      // `return()` (turn early-exit — e.g. `collectFinalTranscript` breaks early,
      // or the turn aborts). The pump checks it before every send and stops pushing
      // audio at once, rather than continuing to drive the ASR session the consumer
      // abandoned. The inbound audio source is drained through an explicit iterator
      // so the `finally` can `return()` it, terminating the pump's `for await` and
      // releasing the upstream audio generator too.
      let cancelled = false
      const audioIterator = audio[Symbol.asyncIterator]()
      const pump = (async () => {
        if (cancelled) return
        socket.send(
          asArrayBuffer(
            buildSttConfigFrame({
              uid: connectId,
              format: 'pcm',
              sampleRate,
              model: sttModel,
            })
          )
        )
        let seq = 1
        let pending: Uint8Array | undefined
        for (;;) {
          const next = await audioIterator.next()
          if (next.done) break
          if (cancelled) return
          if (pending !== undefined) {
            seq += 1
            socket.send(asArrayBuffer(buildSttAudioFrame(pending, seq, false)))
            sentAudioBytes += pending.byteLength
          }
          pending = next.value
        }
        if (cancelled) return
        // Flag the final audio packet with a negative sequence.
        seq += 1
        const last = pending ?? new Uint8Array(0)
        socket.send(asArrayBuffer(buildSttAudioFrame(last, seq, true)))
        sentAudioBytes += last.byteLength
      })()
      pump.catch((err) => queue.fail(err))

      try {
        yield* queue
      } finally {
        // Runs on every exit path: normal completion (the terminal transcript
        // closed the queue), a provider error (the queue was failed), and — the
        // resource-leak fix — consumer cancellation via `transcribe`'s iterator
        // `return()` when the turn exits early. On the cancellation path the queue
        // is still open and the pump may be parked pulling the next audio frame, so
        // without this the outbound Volcengine ASR socket would leak and audio keep
        // streaming. Cleanup is idempotent so it never disturbs the already-settled
        // normal / error paths:
        //  - `cancelled` short-circuits any further pump sends;
        //  - `audioIterator.return()` ends the pump's `for await` and releases the
        //    upstream audio generator;
        //  - `queue.close()` is idempotent on an already-closed/failed queue;
        //  - `socket.close()` deterministically releases the outbound connection
        //    (idempotent; the normal path already closes it on a final transcript).
        //
        // Usage settle (runs on every exit path, so even a failed/cancelled
        // connection reports what it consumed): prefer the server's cumulative
        // duration report when any response carried one (`provider-reported`),
        // else convert the audio bytes actually sent at the exact PCM16 byte
        // rate (`derived-from-bytes`).
        stt.lastUsage =
          reportedDurationMs !== undefined
            ? { durationMs: reportedDurationMs, source: 'provider-reported' }
            : { durationMs: (sentAudioBytes * 1000) / bytesPerSecond, source: 'derived-from-bytes' }
        cancelled = true
        // Stop both deadlines on every exit path (either may still be armed if the
        // stream ended via cancellation / error) so neither fires late against an
        // already-settled queue: the first-response deadline (no transcript yet) and
        // the inter-chunk idle deadline (streaming was in progress).
        firstResponseDeadline.cancel()
        streamIdleDeadline?.cancel()
        await audioIterator.return?.(undefined)
        queue.close()
        socket.close()
      }
    },
  }

  const tts: TtsProvider = {
    async *synthesize(text: AsyncIterable<string>): AsyncIterable<TtsAudioChunk> {
      const connectId = randomId()
      const sessionId = randomId()
      const ttsStart = Date.now()
      let ttsFrameCount = 0
      let firstFrameTraced = false
      const headers = buildAuthHeaders(
        { apiKey: opts.apiKey, resourceId: ttsResourceId },
        connectId
      )
      const socket = await connect(TTS_URL, headers)
      const queue = new AsyncQueue<TtsAudioChunk>()
      const handshake = new TtsHandshake()
      // Tracks whether the session reached its normal completion (SessionFinished,
      // event 152). A socket close is only a clean end-of-stream once this is set;
      // a close BEFORE it (handshake-period failure, mid-stream network drop) is a
      // premature close that must fail the queue, so a turn with text but missing
      // TTS audio fails loudly instead of settling silently without audio.
      let sessionFinished = false

      // Idle guard for the audio-streaming phase. The opening handshake gates
      // (ConnectionStarted / SessionStarted) are first-response-bounded by
      // `awaitWithTimeout` in the pump, and the close-side `sessionFinished` gate is
      // intentionally unbounded (a long synthesis legitimately keeps it open). That
      // leaves the audio stream that follows the handshake unbounded in two ways:
      //  (1) after the first `TtsResponse` chunk — the server emits audio then falls
      //      silent (no further audio, no SessionFinished, never closes); and
      //  (2) BEFORE any audio — the handshake completes and FinishSession is sent,
      //      then the server produces neither audio nor SessionFinished.
      // Either parks `yield* queue` forever — the LLM SSE park, one layer over. This
      // guard bounds the silent GAP during synthesis: armed when the pump sends
      // FinishSession (case 2; by then all text is drained, so a slow upstream LLM
      // can't false-trip it) AND (re)armed on each `TtsResponse` chunk (case 1),
      // cancelled the instant the session ends (SessionFinished / SessionFailed /
      // close / error / generator exit). On a stall it drives the same fail-loud path
      // a mid-stream drop takes (abort the handshake gates, fail the queue, close the
      // socket). Push model, so it is a re-armable deadline reset per pushed frame /
      // milestone, NOT the SSE per-read race. Bounds only the gap, never total
      // synthesis length — a long but live stream keeps resetting it.
      let streamIdleDeadline: Deadline | undefined
      const resetStreamIdle = (): void => {
        streamIdleDeadline?.cancel()
        streamIdleDeadline = startDeadline(TIMEOUTS.streamIdleMs, () => {
          const err = new Error(
            `Volcengine TTS: audio stream idle for >${TIMEOUTS.streamIdleMs}ms during synthesis`
          )
          traceTurnError('tts', 'stream-idle-timeout', {
            ms: TIMEOUTS.streamIdleMs,
            frameCount: ttsFrameCount,
            sessionId,
          })
          handshake.abort(err)
          queue.fail(err)
          socket.close()
        })
      }

      socket.addEventListener('message', (event) => {
        try {
          const frame = parseFrame(event.data)
          if (frame.messageType === MessageType.ErrorResponse) {
            const err = new Error(`Volcengine TTS error: ${decodeUtf8(frame.payload)}`)
            // Payload BYTE length only — never the decoded error text.
            traceTurnError('tts', 'error-frame', { payloadBytes: frame.payload.length, sessionId })
            streamIdleDeadline?.cancel()
            handshake.abort(err)
            queue.fail(err)
            return
          }
          // Drive the connection/session-acceptance gates from server events; a
          // handshake-control event advances the gate and needs no further
          // handling here.
          if (handshake.handleEvent(frame.event, () => decodeUtf8(frame.payload))) {
            return
          }
          if (frame.event === TtsEvent.TtsResponse && frame.payload.length > 0) {
            ttsFrameCount += 1
            if (!firstFrameTraced) {
              firstFrameTraced = true
              // First synthesized audio frame back from the server — the signal
              // that crossed the LLM->TTS boundary into actual audio output.
              traceTurn('tts', 'first-frame', {
                frameBytes: frame.payload.length,
                elapsedMs: Date.now() - ttsStart,
                sessionId,
              })
            }
            queue.push({ audio: copyBytes(frame.payload), done: false })
            // Streaming audio — (re)arm the inter-chunk idle guard for the gap to
            // the next audio chunk.
            resetStreamIdle()
          } else if (frame.event === TtsEvent.SessionFinished) {
            // Normal completion: push the final done frame, mark the session
            // finished so a subsequent socket close is the clean end-of-stream,
            // and end iteration. Clear the idle guard so it cannot fire late.
            sessionFinished = true
            traceTurn('tts', 'session-finished', {
              frameCount: ttsFrameCount,
              elapsedMs: Date.now() - ttsStart,
              sessionId,
            })
            streamIdleDeadline?.cancel()
            queue.push({ audio: new Uint8Array(0), done: true })
            queue.close()
          } else if (frame.event === TtsEvent.SessionFailed) {
            const err = new Error(`Volcengine TTS session failed: ${decodeUtf8(frame.payload)}`)
            // Payload BYTE length only — never the decoded failure text.
            traceTurnError('tts', 'session-failed', {
              payloadBytes: frame.payload.length,
              sessionId,
            })
            streamIdleDeadline?.cancel()
            handshake.abort(err)
            queue.fail(err)
          }
        } catch (err) {
          streamIdleDeadline?.cancel()
          handshake.abort(err)
          queue.fail(err)
        }
      })
      // A socket close before the handshake completes must reject the pending
      // gates so the pump fails loudly rather than awaiting a frame forever.
      // `abort` is harmless once the gates have all settled (no-op on a settled
      // gate), so it runs unconditionally on every close.
      socket.addEventListener('close', (event) => {
        traceTurn('tts', 'socket-close', {
          code: event?.code,
          reasonChars: (event?.reason ?? '').length,
          sessionFinished,
          frameCount: ttsFrameCount,
          sessionId,
        })
        // The session has ended either way — stop the idle guard so it cannot fire
        // late against an already-settled queue.
        streamIdleDeadline?.cancel()
        handshake.abort(new Error('Volcengine TTS socket closed before session completed'))
        // Distinguish a normal-completion close from a premature one. After
        // SessionFinished (152) the close is the expected end-of-stream -> close
        // the queue normally. Before it (handshake race / mid-stream drop) the
        // close is premature: fail the queue so the consumer (`runTurn`'s TTS
        // extraction) throws and the provider call fails loud, rather than the
        // turn silently settling with text but no/partial audio.
        if (sessionFinished) {
          queue.close()
        } else {
          queue.fail(new Error('Volcengine TTS socket closed before session finished'))
        }
      })
      socket.addEventListener('error', (err) => {
        streamIdleDeadline?.cancel()
        handshake.abort(err)
        queue.fail(err)
      })

      // Event-driven handshake, server-gated on both ends. Each client frame
      // waits for the server to accept the previous step before being sent:
      // StartConnection -> (await ConnectionStarted) -> StartSession -> (await
      // SessionStarted) -> TaskRequest(s) -> FinishSession -> (await
      // SessionFinished) -> FinishConnection. After FinishSession the server
      // streams the remaining TTSResponse audio frames and then SessionFinished;
      // gating FinishConnection on SessionFinished (rather than firing it
      // immediately after FinishSession) lets the listener drain that tail audio
      // before the connection closes, so the last synthesized frames are never
      // truncated. This mirrors the start-side gating symmetrically.
      //
      // `cancelled` is set by the generator's `finally` when the consumer calls
      // `return()` (turn early-exit). The pump checks it before every send so a
      // cancellation that lands mid-send-sequence stops issuing frames at once,
      // rather than continuing to drive (and bill) a session the consumer has
      // abandoned. The awaited gates are rejected by the same `finally` via
      // `handshake.abort`, so a pump parked on a gate unblocks instead of hanging.
      let cancelled = false
      const pump = (async () => {
        if (cancelled) return
        socket.send(asArrayBuffer(buildTtsStartConnectionFrame()))
        // First-response timeout on each OPENING handshake gate: if the server
        // accepts the upgrade but never sends ConnectionStarted (50) / SessionStarted
        // (150), the pump would `await` a gate promise forever. Race each gate
        // against a first-response deadline whose `onTimeout` calls `handshake.abort`
        // — which rejects the pending gate exactly as a ConnectionFailed/socket-close
        // would, so a silent server degrades into the existing fail-loud path
        // (queue.fail -> consumer throws) instead of parking the turn. Only the
        // opening gates are bounded; the close-side `sessionFinished` gate is NOT,
        // because it legitimately stays open for the full length of a long synthesis
        // stream (bounding it would truncate valid tail audio — a whole-turn timeout,
        // which this fix explicitly avoids).
        await awaitWithTimeout(
          handshake.connectionStarted,
          TIMEOUTS.firstResponseMs,
          `Volcengine TTS: no ConnectionStarted within ${TIMEOUTS.firstResponseMs}ms`,
          () => {
            traceTurnError('tts', 'connection-started-timeout', {
              ms: TIMEOUTS.firstResponseMs,
              sessionId,
            })
            handshake.abort(
              new Error(`Volcengine TTS: no ConnectionStarted within ${TIMEOUTS.firstResponseMs}ms`)
            )
          }
        )
        if (cancelled) return
        socket.send(
          asArrayBuffer(
            buildTtsStartSessionFrame({
              sessionId,
              speaker: ttsSpeaker,
              sampleRate,
              model: ttsModel,
            })
          )
        )
        await awaitWithTimeout(
          handshake.sessionStarted,
          TIMEOUTS.firstResponseMs,
          `Volcengine TTS: no SessionStarted within ${TIMEOUTS.firstResponseMs}ms`,
          () => {
            traceTurnError('tts', 'session-started-timeout', {
              ms: TIMEOUTS.firstResponseMs,
              sessionId,
            })
            handshake.abort(
              new Error(`Volcengine TTS: no SessionStarted within ${TIMEOUTS.firstResponseMs}ms`)
            )
          }
        )
        for await (const piece of text) {
          if (cancelled) return
          if (piece.length === 0) continue
          socket.send(
            asArrayBuffer(buildTtsTaskRequestFrame({ sessionId, text: piece, speaker: ttsSpeaker }))
          )
        }
        if (cancelled) return
        // All upstream text has been fed; FinishSession is now sent and the
        // server must produce audio then SessionFinished.
        socket.send(asArrayBuffer(buildTtsFinishSessionFrame(sessionId)))
        // Arm the idle guard for the synthesis-output phase now that all text is
        // drained: from here the server must produce audio frames then
        // SessionFinished. If it instead goes fully silent (no audio, no
        // SessionFinished), `await handshake.sessionFinished` below — the
        // intentionally-unbounded close gate — would park the turn forever. Arming
        // here (post-text, so a slow LLM can't false-trip it) bounds that gap; the
        // first audio frame / SessionFinished cancels or resets it via the listener.
        resetStreamIdle()
        await handshake.sessionFinished
        if (cancelled) return
        socket.send(asArrayBuffer(buildTtsFinishConnectionFrame()))
      })()
      pump.catch((err) => queue.fail(err))

      try {
        yield* queue
      } finally {
        // Runs on every exit path: normal completion (SessionFinished closed the
        // queue), a provider error (the queue was failed), and — the resource-leak
        // fix — consumer cancellation via `ttsIterator.return()` when the turn
        // exits early (owner `end`, socket close, STT/LLM failure). On the
        // cancellation path the queue is still open and the pump may be parked on a
        // handshake gate or sending TaskRequests, so without this the outbound
        // Volcengine TTS socket would leak and the session keep billing. Cleanup is
        // idempotent so it never disturbs the already-settled normal / error paths:
        //  - `cancelled` short-circuits any further pump sends;
        //  - `handshake.abort` rejects only NOT-yet-settled gates (no-op once the
        //    handshake completed normally), unblocking a parked pump;
        //  - `queue.close()` is idempotent on an already-closed/failed queue;
        //  - `socket.close()` deterministically releases the outbound connection
        //    (idempotent; the normal path relies on the server closing it).
        cancelled = true
        // Stop the inter-chunk idle guard on every exit path (it may still be armed
        // if the stream ended via cancellation / error mid-synthesis) so it never
        // fires late against an already-settled queue.
        streamIdleDeadline?.cancel()
        handshake.abort(new Error('Volcengine TTS synthesize cancelled'))
        queue.close()
        socket.close()
      }
    },
  }

  return { stt, tts }
}

// --- Small helpers ---

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Copy into a standalone ArrayBuffer so the WS send sees exact frame bounds.
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  out.set(bytes)
  return out
}

function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}

function randomId(): string {
  return crypto.randomUUID()
}
