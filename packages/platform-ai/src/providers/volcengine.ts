/**
 * Volcengine (火山引擎) speech adapter — the shared platform voice layer.
 *
 * One adapter backs BOTH the STT and TTS provider interfaces (see
 * `providers/types.ts`), because the L2 spec models voice as a single shared
 * platform layer rather than one speech vendor per LLM provider.
 *
 *  - STT: Volcengine big-model streaming ASR over its self-owned binary
 *    WebSocket protocol (`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`,
 *    resource `volc.bigasr.sauc.duration`). The first frame is a JSON
 *    full-client config request; subsequent frames are raw audio. Server
 *    responses carry a JSON transcript whose `utterances[].definite` marks a
 *    stabilized segment. This ASR protocol is *client-push-first by design*:
 *    the documented flow is "send full-client request, then stream audio packets
 *    (~100-200ms each)"; there is NO connection/session-accepted handshake event
 *    the client must wait for before sending audio (unlike the TTS layer below).
 *    So sending config-then-audio without a server "ready" gate is correct here,
 *    not optimistic — the server returns transcripts asynchronously as audio
 *    flows.
 *  - TTS: Doubao TTS 2.0 bidirectional streaming over the event-based binary
 *    protocol (`wss://openspeech.bytedance.com/api/v3/tts/bidirection`,
 *    resource `volc.service_type.10029`). This protocol is *stateful and
 *    server-gated*: the client must wait for the server to accept each step
 *    before advancing — StartConnection -> (await ConnectionStarted, event 50)
 *    -> StartSession -> (await SessionStarted, event 150) -> TaskRequest* ->
 *    FinishSession -> FinishConnection; the server then streams `TTSResponse`
 *    (event 352) audio frames + `SessionFinished` (event 152). The handshake
 *    gates live in `TtsHandshake` so the timing is unit-testable with a mock WS.
 *
 * Protocol references (consulted 2026-06):
 *  - ASR binary protocol + sequence flags + auth headers:
 *    https://www.volcengine.com/docs/6561/1354869
 *  - TTS 2.0 bidirectional event protocol:
 *    https://www.volcengine.com/docs/6561/1329505
 *
 * Cloudflare Workers runtime note: these v3 endpoints authenticate entirely via
 * custom request headers (`X-Api-App-Key` / `X-Api-Access-Key` /
 * `X-Api-Resource-Id` + a per-connection `X-Api-Connect-Id` UUID) — pure
 * token-header auth, no HMAC signature and no secret key (the secret-key
 * signature scheme is the legacy v1/v2 console-auth path this adapter does not
 * use). The bare `new WebSocket(url)` constructor cannot set request headers in
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
import type { SttProvider, SttTranscriptChunk, TtsAudioChunk, TtsProvider } from './types'

// --- Public options ---

/**
 * Credentials + tuning for the Volcengine speech adapter. All credentials are
 * server-side env values; never hard-code them and never forward them to a
 * browser client.
 */
export interface VolcengineSpeechOptions {
  /** Volcengine app id, sent as the `X-Api-App-Key` header. */
  appId: string
  /** Volcengine access token, sent as the `X-Api-Access-Key` header. */
  accessToken: string
  /**
   * Resource id for the ASR endpoint (`X-Api-Resource-Id`). Defaults to
   * `volc.bigasr.sauc.duration` (duration-billed big-model ASR).
   */
  sttResourceId?: string
  /**
   * Resource id for the TTS endpoint (`X-Api-Resource-Id`). Defaults to
   * `volc.service_type.10029` (Doubao TTS 2.0 bidirectional streaming).
   */
  ttsResourceId?: string
  /** ASR model name in the config request (`request.model_name`). */
  sttModel?: string
  /**
   * TTS model id, set as the Doubao TTS 2.0 `StartSession` `req_params.model`
   * when provided. `req_params.model` is a real (optional) request field on the
   * bidirectional protocol; its legal wire value is the model-family token
   * `seed-tts-2.0` (NOT the product alias `doubao-tts-2.0`), and it must agree
   * with the paired endpoint resource id (`X-Api-Resource-Id`, default
   * `volc.service_type.10029`). Carrying the resolved config model here makes a
   * `provider-config` model switch reach the wire instead of being a silent
   * no-op. Omitted when unset (the field is simply not sent) — a Doubao TTS 2.0
   * session can be driven by the resource id alone, with `req_params.model` left
   * out — so unset preserves the default request shape.
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
  addEventListener(type: 'close', listener: () => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
}

/** Opens an authenticated WebSocket to `url` with the given request headers. */
export type WebSocketConnector = (
  url: string,
  headers: Record<string, string>
) => Promise<AdapterSocket>

// --- Endpoints + protocol constants ---

const STT_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel'
const TTS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection'
const DEFAULT_STT_RESOURCE_ID = 'volc.bigasr.sauc.duration'
const DEFAULT_TTS_RESOURCE_ID = 'volc.service_type.10029'
const DEFAULT_STT_MODEL = 'bigmodel'
const DEFAULT_TTS_SPEAKER = 'zh_female_cancan_mars_bigtts'
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
 * Assemble the WebSocket-handshake auth headers. Both the v3 big-model ASR and
 * the Doubao TTS 2.0 endpoints authenticate via the same `X-Api-*` header set;
 * `resourceId` selects the endpoint. `Upgrade: websocket` is required so the
 * Workers `fetch` performs the upgrade (the bare `WebSocket` constructor cannot
 * carry these custom headers).
 *
 * The v3 streaming endpoints use pure token-header auth — no HMAC signature, no
 * secret key. The four headers are: `X-Api-App-Key` (app id), `X-Api-Access-Key`
 * (access token), `X-Api-Resource-Id` (endpoint selector), and `X-Api-Connect-Id`
 * (a per-connection UUID for handshake-level connection tracing — NOT the
 * business `X-Api-Request-Id`, which is the per-request id used by the HTTP/
 * recording-file APIs, not by this WS handshake).
 */
export function buildAuthHeaders(
  opts: { appId: string; accessToken: string; resourceId: string },
  connectId: string
): Record<string, string> {
  return {
    Upgrade: 'websocket',
    'X-Api-App-Key': opts.appId,
    'X-Api-Access-Key': opts.accessToken,
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
 * Build a TTS event frame: `[header][event][sessionIdSize][sessionId?][payloadSize][payload]`.
 *
 * Connection-scoped events (StartConnection / FinishConnection) carry an empty
 * session id; session-scoped events (StartSession / TaskRequest /
 * FinishSession) carry the session id assigned by the client.
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
  const sessionIdBytes = textEncoder.encode(args.sessionId)
  return concatBytes([
    header,
    int32BE(args.event),
    int32BE(sessionIdBytes.length),
    sessionIdBytes,
    int32BE(args.payload.length),
    args.payload,
  ])
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
 * threaded into `req_params` only when provided (the resolved config model), so
 * the default request shape is unchanged when no model is configured.
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
    // TTS event frame: [event][sessionIdSize][sessionId][payloadSize][payload].
    frame.event = view.getInt32(offset, false)
    offset += 4
    const sessionIdSize = view.getInt32(offset, false)
    offset += 4
    frame.sessionId = textDecoder.decode(bytes.subarray(offset, offset + sessionIdSize))
    offset += sessionIdSize
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
 * Map a parsed ASR server-response frame to a transcript chunk. Returns
 * `undefined` for frames with no transcript text (e.g. an empty ack). A
 * segment is final when any utterance reports `definite: true`.
 */
export function parseSttResponse(frame: ParsedFrame): SttTranscriptChunk | undefined {
  if (frame.messageType === MessageType.ErrorResponse) {
    throw new Error(`Volcengine ASR error: ${textDecoder.decode(frame.payload)}`)
  }
  if (frame.serialization !== Serialization.Json || frame.payload.length === 0) {
    return undefined
  }
  const body = JSON.parse(textDecoder.decode(frame.payload)) as {
    result?: {
      text?: string
      utterances?: Array<{ definite?: boolean }>
    }
  }
  const result = body.result
  if (!result || typeof result.text !== 'string') {
    return undefined
  }
  const isFinal = (result.utterances ?? []).some((u) => u.definite === true)
  return { text: result.text, isFinal }
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
  const response = await fetch(toFetchUpgradeUrl(url), { headers })
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
 * Build the Volcengine speech provider pair. The returned object satisfies both
 * `SttProvider` and `TtsProvider`; the platform wires the same instance into
 * both layer slots (the voice layer is shared, per the L2 spec).
 */
export function createVolcengineSpeechProvider(opts: VolcengineSpeechOptions): {
  stt: SttProvider
  tts: TtsProvider
} {
  const connect = opts.connect ?? defaultConnect
  const sttResourceId = opts.sttResourceId ?? DEFAULT_STT_RESOURCE_ID
  const ttsResourceId = opts.ttsResourceId ?? DEFAULT_TTS_RESOURCE_ID
  const sttModel = opts.sttModel ?? DEFAULT_STT_MODEL
  const ttsModel = opts.ttsModel
  const ttsSpeaker = opts.ttsSpeaker ?? DEFAULT_TTS_SPEAKER
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE

  const stt: SttProvider = {
    async *transcribe(audio: AsyncIterable<AudioChunk>): AsyncIterable<SttTranscriptChunk> {
      const connectId = randomId()
      const headers = buildAuthHeaders(
        { appId: opts.appId, accessToken: opts.accessToken, resourceId: sttResourceId },
        connectId
      )
      const socket = await connect(STT_URL, headers)
      const queue = new AsyncQueue<SttTranscriptChunk>()

      socket.addEventListener('message', (event) => {
        try {
          const frame = parseFrame(event.data)
          const chunk = parseSttResponse(frame)
          if (!chunk) return
          queue.push(chunk)
          // A final/definite transcript is the normal completion signal: end the
          // iteration here instead of waiting for a separate WS `close`. Without
          // this, `collectFinalTranscript` (which drains `transcribe` to iterator
          // end) would hang the whole turn whenever the server keeps the socket
          // open after the definite result. Push the chunk first, then close, so
          // the final transcript is never dropped. Also close the ASR socket as
          // the normal end-of-stream path (idempotent; mirrors the TTS layer).
          if (chunk.isFinal) {
            queue.close()
            socket.close()
          }
        } catch (err) {
          queue.fail(err)
        }
      })
      socket.addEventListener('close', () => queue.close())
      socket.addEventListener('error', (err) => queue.fail(err))

      // Pump audio in the background so we can yield transcripts as they arrive.
      const pump = (async () => {
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
        for await (const frame of audio) {
          if (pending !== undefined) {
            seq += 1
            socket.send(asArrayBuffer(buildSttAudioFrame(pending, seq, false)))
          }
          pending = frame
        }
        // Flag the final audio packet with a negative sequence.
        seq += 1
        const last = pending ?? new Uint8Array(0)
        socket.send(asArrayBuffer(buildSttAudioFrame(last, seq, true)))
      })()
      pump.catch((err) => queue.fail(err))

      yield* queue
    },
  }

  const tts: TtsProvider = {
    async *synthesize(text: AsyncIterable<string>): AsyncIterable<TtsAudioChunk> {
      const connectId = randomId()
      const sessionId = randomId()
      const headers = buildAuthHeaders(
        { appId: opts.appId, accessToken: opts.accessToken, resourceId: ttsResourceId },
        connectId
      )
      const socket = await connect(TTS_URL, headers)
      const queue = new AsyncQueue<TtsAudioChunk>()
      const handshake = new TtsHandshake()

      socket.addEventListener('message', (event) => {
        try {
          const frame = parseFrame(event.data)
          if (frame.messageType === MessageType.ErrorResponse) {
            const err = new Error(`Volcengine TTS error: ${decodeUtf8(frame.payload)}`)
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
            queue.push({ audio: copyBytes(frame.payload), done: false })
          } else if (frame.event === TtsEvent.SessionFinished) {
            queue.push({ audio: new Uint8Array(0), done: true })
            queue.close()
          } else if (frame.event === TtsEvent.SessionFailed) {
            const err = new Error(`Volcengine TTS session failed: ${decodeUtf8(frame.payload)}`)
            handshake.abort(err)
            queue.fail(err)
          }
        } catch (err) {
          handshake.abort(err)
          queue.fail(err)
        }
      })
      // A socket close before the handshake completes must reject the pending
      // gates so the pump fails loudly rather than awaiting a frame forever.
      socket.addEventListener('close', () => {
        handshake.abort(new Error('Volcengine TTS socket closed before session completed'))
        queue.close()
      })
      socket.addEventListener('error', (err) => {
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
      const pump = (async () => {
        socket.send(asArrayBuffer(buildTtsStartConnectionFrame()))
        await handshake.connectionStarted
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
        await handshake.sessionStarted
        for await (const piece of text) {
          if (piece.length === 0) continue
          socket.send(
            asArrayBuffer(buildTtsTaskRequestFrame({ sessionId, text: piece, speaker: ttsSpeaker }))
          )
        }
        socket.send(asArrayBuffer(buildTtsFinishSessionFrame(sessionId)))
        await handshake.sessionFinished
        socket.send(asArrayBuffer(buildTtsFinishConnectionFrame()))
      })()
      pump.catch((err) => queue.fail(err))

      yield* queue
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
