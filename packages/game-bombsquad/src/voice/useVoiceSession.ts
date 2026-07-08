/**
 * `useVoiceSession` — the BombSquad client for one platform-ai voice session,
 * hands-free full-duplex.
 *
 * Runs the whole conversation against the deployed `@amiclaw/platform-ai` Worker
 * over the same-origin `/ai-ws/*` WebSocket: connect -> create session -> open
 * the mic ONCE and stream PCM16 16 kHz frames continuously -> the AI greets first
 * and answers each utterance -> render the AI's streamed text + play its TTS audio
 * -> end session. There is NO push-to-talk; the player just talks.
 *
 * Turn model (important): the CLIENT runs the VAD. On `create` the server fires
 * the AI-first opening greeting (no client input). Thereafter the hook streams the
 * mic continuously; the client-side VAD detects utterance START (the player began
 * speaking) and sends `{type:'speech-start'}`, which opens the server recognizer
 * so it transcribes LIVE while the player talks, then detects end-of-utterance
 * (the player went silent) and sends `{type:'turn'}`, which finalizes that turn as
 * a normal STT->LLM->TTS turn over the audio buffered since the last turn. One
 * speech-start per utterance, paired with the one turn. Turns are SERIAL
 * server-side: a `turn` sent while one is in flight is rejected with a benign
 * `turn_in_flight`, so BOTH sends fire only when the AI is idle (not speaking, not
 * awaiting, not mid-stream) — otherwise the open mic picking up the AI's own
 * greeting / the stopwatch tick would open a spurious utterance / fire a rejected
 * turn. The one mid-stream exception is a genuine barge-in (the player talks over
 * the AI): it stops local playback AND signals speech-start, since the player has
 * taken the floor. The VAD additionally drives the 3-state conversation phase
 * (listening / thinking / speaking).
 *
 * Security invariant (load-bearing, mirrors the demo): this hook connects ONLY to
 * the same-origin Worker WS and sends ONLY `{gameId, manualData, gameState,
 * gameRunId}` plus binary audio. It carries NO provider key, NO system prompt,
 * and NO userId — the session cookie authenticates same-origin and the server
 * holds every secret.
 *
 * Audio formats (both 16 kHz mono PCM16):
 *  - mic capture: `AudioContext({ sampleRate: 16000 })` + `ScriptProcessorNode`,
 *    Float32 -> Int16 LE per frame (`floatTo16BitPCM`), sent as binary WS frames.
 *    The mic stays open for the whole session. `getUserMedia` requests echo
 *    cancellation + noise suppression so the open mic does not pick up the AI's
 *    own voice (which would self-trigger barge-in).
 *  - TTS playback: base64 audio frame -> Int16 LE -> Float32 (`pcm16ToFloat32`),
 *    wrapped in an `AudioBuffer` at 16000 Hz and scheduled gaplessly. The playback
 *    `AudioContext` runs at its native rate and resamples the 16 kHz buffers.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { GameState, ManualData, RecapOutcome } from '@amiclaw/platform-ai/contract'
import { base64ToBytes, floatTo16BitPCM, pcm16ToFloat32, resamplePcmFloat32 } from './audio-pcm'
import {
  buildSessionUrl,
  deriveConversationPhase,
  initialVoiceState,
  randomSessionName,
  voiceReducer,
  type ConversationPhase,
  type ServerFrame,
  type VoiceStatus,
} from './voice-session-protocol'
import {
  computeRms,
  DEFAULT_VAD_CONFIG,
  initialVadState,
  vadStep,
  type VadState,
} from './voice-vad'

/** Volcengine TTS output sample rate (`volcengine.ts` `DEFAULT_SAMPLE_RATE`). */
const TTS_OUTPUT_SAMPLE_RATE = 16000
/** Mic capture rate — the STT adapter's exact wire rate (PCM16 16 kHz mono). */
const CAPTURE_SAMPLE_RATE = 16000
/** ScriptProcessor buffer size (frames). Matches the demo. */
const CAPTURE_BUFFER_SIZE = 4096
/**
 * How long to wait for a turn's first response chunk before assuming the server
 * skipped it (a no-speech / spurious-VAD turn yields no chunks and no `done`).
 * Generous enough to cover a real STT->LLM->TTS first-chunk latency.
 */
const NO_RESPONSE_TIMEOUT_MS = 12000

/**
 * Close an `AudioContext` and release its hardware resources, swallowing the
 * (possible) rejection. Browsers cap the number of concurrent `AudioContext`s,
 * so a leaked context across turns / panel remounts eventually starves the next
 * `new AudioContext(...)` — which is the failure this hardening guards against.
 */
/**
 * Stable signature of the manual-subset selection, for change detection across
 * renders. A new selection (the player advanced modules) yields a different
 * string; an unchanged selection (a timer-frame re-render) yields the same one,
 * so the `update-gamestate` steer fires exactly once per real module change.
 */
function sectionsSignature(gameState: GameState): string {
  return JSON.stringify(gameState.relevantSections ?? [])
}

function closeAudioContext(ctx: AudioContext | null): void {
  if (!ctx) return
  try {
    const closing = ctx.close()
    if (closing && typeof closing.then === 'function') {
      closing.catch(() => {
        /* ignore — context may already be closed */
      })
    }
  } catch {
    /* ignore — context may already be closed */
  }
}

export interface UseVoiceSessionOptions {
  /** Stable per-run join key shared by voice summary and score settlement. */
  gameRunId?: string
  /**
   * The per-run manual payload (built via `bombsquadManualToManualData`). `null`
   * while the manual is still loading — the hook stays `idle` and connects once a
   * non-null value is provided.
   */
  manualData: ManualData | null
  /**
   * The game state driving manual-subset selection (`relevantSections` via
   * `moduleKindToRelevantSections`). The FIRST value rides the `create` message;
   * a later change (the player advanced modules within one run) is steered on the
   * live socket with a single `update-gamestate` — see the module-change note on
   * the return type.
   */
  gameState: GameState
  /** Platform game id. Defaults to `'bombsquad'`. */
  gameId?: string
  /**
   * The player's current arcade streak in days (B9 叙事型成长). Rides the
   * `create` message so the companion's tone follows the relationship's age
   * (register + memory budget). Omitted / 0 leaves the session byte-identical to
   * the pre-B9 behaviour.
   */
  streakDays?: number
}

export interface UseVoiceSessionResult {
  /** Connection lifecycle status for the panel (socket state). */
  status: VoiceStatus
  /** In-conversation 3-state phase for a live session (listening / thinking / speaking). */
  conversationPhase: ConversationPhase
  /** True while the client VAD reports the player is speaking. */
  playerSpeaking: boolean
  /** Accumulated AI text for the current turn. */
  aiText: string
  /** The player's live recognized speech, streamed as recognition builds (from the `transcript` frames). */
  playerTranscript: string
  /** True while TTS audio is scheduled/playing. */
  isAiSpeaking: boolean
  /** Last bounded error message, or null. */
  error: string | null
  /** Session summary, set once the session ends cleanly. */
  summary: import('@amiclaw/platform-ai/contract').SessionSummary | null
  /** End the session: send `end`, await the summary, and tear down. */
  endSession: () => void
  /**
   * Request the closing-recap turn. Sends `{type:'closing', outcome}` to the DO,
   * which runs one final outcome-aware LLM+TTS recap and streams it back
   * (`defused` = warm congratulation, `exploded` / `timeout` = facts-only). The
   * returned promise resolves when the recap audio has finished playing (all
   * queued TTS frames drained). Resolves immediately if the socket is not open.
   */
  requestClosing: (outcome?: RecapOutcome) => Promise<void>
}

/**
 * Module-change / `gameState` updates: ONE continuous session spans the whole
 * run. The FIRST `gameState.relevantSections` rides the `create` message; when
 * the player advances modules the sections change and the hook steers the LIVE
 * session with a single `{type:'update-gamestate', gameState}` on the same open
 * socket — it does NOT reconnect, so the WS, the mic, the conversation history,
 * and the AI-first greeting all persist (the AI just gets the new module's manual
 * subset for subsequent turns). The update is sent exactly once per actual change
 * and only after the session is `created`; an unchanged re-render sends nothing.
 */
export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSessionResult {
  const { gameRunId, manualData, gameState, gameId = 'bombsquad', streakDays } = options

  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState)
  const [isAiSpeaking, setIsAiSpeaking] = useState(false)
  // Conversation-phase signals. State (drive re-render); mirrored to refs so the
  // audio-thread callbacks + the once-bound socket handlers read current values.
  const [playerSpeaking, setPlayerSpeaking] = useState(false)
  const [awaitingResponse, setAwaitingResponse] = useState(false)
  const awaitingResponseRef = useRef(false)
  /**
   * Watchdog for a turn that gets no response. The server skips a no-speech turn
   * (a spurious VAD trigger / inaudible utterance) silently — zero chunks, no
   * `done` — so without this the UI would hang in `thinking` forever. If no
   * response chunk arrives within the budget, fall back to `listening`.
   */
  const awaitingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest inputs, captured at connect/create time without re-running the connect
  // effect on every prop identity change.
  const manualDataRef = useRef<ManualData | null>(manualData)
  const gameStateRef = useRef<GameState>(gameState)
  const gameIdRef = useRef<string>(gameId)
  const gameRunIdRef = useRef<string | undefined>(gameRunId)
  const streakDaysRef = useRef<number | undefined>(streakDays)
  useEffect(() => {
    manualDataRef.current = manualData
    gameStateRef.current = gameState
    gameIdRef.current = gameId
    gameRunIdRef.current = gameRunId
    streakDaysRef.current = streakDays
  })

  // Side-effect handles (never trigger re-render).
  const wsRef = useRef<WebSocket | null>(null)
  const endedRef = useRef(false)
  const mountedRef = useRef(true)
  /**
   * The `relevantSections` signature already communicated to the live session —
   * set when `create` is sent (the first selection rides that message) and after
   * each `update-gamestate`. A module advance whose new signature differs from
   * this sends exactly one steer; `null` until the session is being created.
   */
  const sentSectionsRef = useRef<string | null>(null)

  const mediaStreamRef = useRef<MediaStream | null>(null)
  const captureCtxRef = useRef<AudioContext | null>(null)
  const captureSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const captureProcRef = useRef<ScriptProcessorNode | null>(null)
  /** True once the mic is acquired and streaming; guards a double mic-open. */
  const capturingRef = useRef(false)
  /** Running VAD state, folded one capture frame at a time. */
  const vadStateRef = useRef<VadState>(initialVadState)
  /** Analyzed-frame wall-clock duration (`bufferSize / actualRate`), ms. */
  const frameMsRef = useRef<number>((CAPTURE_BUFFER_SIZE / CAPTURE_SAMPLE_RATE) * 1000)

  const playbackCtxRef = useRef<AudioContext | null>(null)
  /** Next scheduled playback start time, for gapless PCM frame queueing. */
  const playbackCursorRef = useRef(0)
  /** Count of scheduled-but-not-ended buffers, driving `isAiSpeaking`. */
  const playingCountRef = useRef(0)
  /** Live scheduled sources, so barge-in can stop them without closing the context. */
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  /** True while the AI's current turn is still streaming (last chunk not `done`). */
  const turnStreamingRef = useRef(false)
  /** True while dropping the tail of a barged-in turn (until its `done` chunk). */
  const suppressTurnRef = useRef(false)
  /**
   * Closing-recap tracking. `closingInProgressRef` is true from the moment
   * `{type:'closing'}` is sent until the recap audio finishes playing.
   * `closingDoneRef` flips to true when the recap's terminal `done` chunk
   * arrives — at that point the promise resolves as soon as all queued audio
   * frames drain. `closingResolveRef` holds the pending promise resolver.
   */
  const closingInProgressRef = useRef(false)
  const closingDoneRef = useRef(false)
  const closingResolveRef = useRef<(() => void) | null>(null)

  const safeDispatch = useCallback((action: Parameters<typeof dispatch>[0]) => {
    if (mountedRef.current) dispatch(action)
  }, [])

  const setAwaiting = useCallback((v: boolean) => {
    awaitingResponseRef.current = v
    if (mountedRef.current) setAwaitingResponse(v)
    if (awaitingTimeoutRef.current) {
      clearTimeout(awaitingTimeoutRef.current)
      awaitingTimeoutRef.current = null
    }
    if (v) {
      // No response within the budget => the server skipped this turn (no speech);
      // release the `thinking` wait so the conversation can continue.
      awaitingTimeoutRef.current = setTimeout(() => {
        awaitingTimeoutRef.current = null
        awaitingResponseRef.current = false
        if (mountedRef.current) setAwaitingResponse(false)
      }, NO_RESPONSE_TIMEOUT_MS)
    }
  }, [])

  // --- TTS playback (Web Audio side effects) ---

  const ensurePlaybackCtx = useCallback((): AudioContext | null => {
    if (playbackCtxRef.current) return playbackCtxRef.current
    try {
      const ctx = new AudioContext()
      void ctx.resume?.()
      playbackCtxRef.current = ctx
      playbackCursorRef.current = ctx.currentTime
      return ctx
    } catch {
      return null
    }
  }, [])

  const playAudioFrame = useCallback(
    (bytes: Uint8Array) => {
      const floats = pcm16ToFloat32(bytes)
      if (floats.length === 0) return
      const ctx = ensurePlaybackCtx()
      if (!ctx) return
      try {
        const buffer = ctx.createBuffer(1, floats.length, TTS_OUTPUT_SAMPLE_RATE)
        buffer.getChannelData(0).set(floats)
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        const startAt = Math.max(ctx.currentTime, playbackCursorRef.current)
        source.start(startAt)
        playbackCursorRef.current = startAt + buffer.duration
        playingCountRef.current += 1
        activeSourcesRef.current.add(source)
        setIsAiSpeaking(true)
        source.onended = () => {
          activeSourcesRef.current.delete(source)
          playingCountRef.current = Math.max(0, playingCountRef.current - 1)
          if (playingCountRef.current === 0 && mountedRef.current) setIsAiSpeaking(false)
          // If the closing recap's terminal `done` chunk already arrived and
          // this was the last audio frame, resolve the pending requestClosing
          // promise so GamePage can navigate to the results screen.
          if (playingCountRef.current === 0 && closingDoneRef.current) {
            const resolve = closingResolveRef.current
            if (resolve) {
              closingResolveRef.current = null
              closingInProgressRef.current = false
              closingDoneRef.current = false
              resolve()
            }
          }
        }
      } catch {
        // A playback failure must never break the turn — text still renders.
      }
    },
    [ensurePlaybackCtx]
  )

  /**
   * Stop all scheduled playback immediately but KEEP the playback context alive
   * for the next turn. Used by barge-in — the next AI turn reuses the context.
   */
  const interruptPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        // eslint-disable-next-line react-hooks/immutability -- a Web Audio node held in a ref, not React state; detach its callback before stopping so teardown doesn't re-enter the onended bookkeeping.
        source.onended = null
        source.stop?.()
        source.disconnect?.()
      } catch {
        /* ignore — source may already have ended */
      }
    }
    activeSourcesRef.current.clear()
    playingCountRef.current = 0
    playbackCursorRef.current = playbackCtxRef.current?.currentTime ?? 0
    if (mountedRef.current) setIsAiSpeaking(false)
  }, [])

  /** Stop playback AND release the context — full teardown (unmount / end). */
  const teardownPlayback = useCallback(() => {
    interruptPlayback()
    const ctx = playbackCtxRef.current
    playbackCtxRef.current = null
    playbackCursorRef.current = 0
    closeAudioContext(ctx)
  }, [interruptPlayback])

  // --- Mic capture (continuous, full session) ---

  const stopCapture = useCallback(() => {
    capturingRef.current = false
    vadStateRef.current = initialVadState
    const proc = captureProcRef.current
    if (proc) {
      proc.onaudioprocess = null
      try {
        proc.disconnect()
      } catch {
        /* ignore */
      }
      captureProcRef.current = null
    }
    const source = captureSourceRef.current
    if (source) {
      try {
        source.disconnect()
      } catch {
        /* ignore */
      }
      captureSourceRef.current = null
    }
    const ctx = captureCtxRef.current
    captureCtxRef.current = null
    closeAudioContext(ctx)
    const stream = mediaStreamRef.current
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }
  }, [])

  /** A VAD `utterance-end`: the player went silent after speaking. */
  const onUtteranceEnd = useCallback(() => {
    setPlayerSpeaking(false)
    // Only hand the floor to the server when the AI is idle. The server runs each
    // `turn` as a real, SERIAL turn and rejects an overlap with `turn_in_flight`,
    // so a `turn` sent while the AI's audio is still playing, while we are already
    // awaiting a reply, or while a (non-barged-in) turn is still streaming would
    // race the in-flight turn — the AI-first opening greeting is the worst case,
    // where the greeting's own voice / the stopwatch tick leaking into the open
    // mic fired a spurious utterance. Suppress those. The one mid-stream case that
    // DOES still send is a genuine barge-in: `onSpeechStart` already stopped
    // playback and flagged the interrupted turn (`suppressTurnRef`), so the player
    // has taken the floor and their next utterance is a real turn.
    const aiHoldsFloor =
      playingCountRef.current > 0 ||
      awaitingResponseRef.current ||
      (turnStreamingRef.current && !suppressTurnRef.current)
    if (aiHoldsFloor) return
    setAwaiting(true)
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'turn' }))
      } catch {
        /* non-fatal — a dropped turn just means this utterance isn't answered */
      }
    }
  }, [setAwaiting])

  /** A VAD `speech-start`: the player began an utterance (incl. barge-in). */
  const onSpeechStart = useCallback(() => {
    // Barge-in: the player is talking while the AI's audio is playing. Stop the
    // playback at once and drop the rest of the interrupted turn's streamed
    // chunks (text + audio) — the server keeps streaming them (it cancels nothing
    // in v1), so the client must locally discard them until that turn's `done`.
    const bargeIn = playingCountRef.current > 0
    if (bargeIn) {
      interruptPlayback()
      if (turnStreamingRef.current) suppressTurnRef.current = true
      safeDispatch({ type: 'barge-in' })
    }
    // Signal the utterance START to the server so it opens the recognizer and
    // transcribes LIVE while the player speaks; the matching `turn` on
    // utterance-end finalizes it (one speech-start per utterance, paired with the
    // one turn). Guard it the SAME way the `turn` send in `onUtteranceEnd` is
    // guarded — only signal a REAL utterance. A genuine barge-in (the player took
    // the floor over the AI's own audio) IS a real utterance, so it signals after
    // the interrupt above; otherwise suppress while the AI holds the floor (the
    // AI-first opening greeting / a pending reply — `awaitingResponse`, set until
    // the first reply chunk — or a non-barged-in turn still streaming), so the
    // greeting's own voice or a leaked stopwatch tick cannot open a spurious
    // utterance. The mic only opens on `created`, so this never fires pre-session.
    const aiHoldsFloor =
      !bargeIn &&
      (awaitingResponseRef.current || (turnStreamingRef.current && !suppressTurnRef.current))
    if (aiHoldsFloor) return
    // Only a REAL utterance (a fresh turn, or a genuine barge-in) flips the phase
    // to `listening`. Setting this BEFORE the guard made a suppressed speech-start
    // — a breath / room-noise tail crossing the VAD threshold for 400ms while the
    // AI is still `thinking` (awaitingResponse) — yank the indicator straight from
    // `thinking` back to `listening`, reading as "it heard me finish, then ignored
    // me". The server-side send is already suppressed for this case; the UI phase
    // must be suppressed in lockstep, so it stays `thinking` until the reply lands
    // (or the no-response watchdog fires).
    setPlayerSpeaking(true)
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'speech-start' }))
      } catch {
        /* non-fatal — a dropped speech-start just defers live transcription to the turn */
      }
    }
  }, [interruptPlayback, safeDispatch])

  const startCapture = useCallback(() => {
    if (capturingRef.current) return
    capturingRef.current = true
    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      } catch {
        capturingRef.current = false
        safeDispatch({ type: 'mic-error', message: 'microphone permission denied' })
        return
      }
      // The panel may have unmounted / the socket closed during the async acquire.
      if (!mountedRef.current || !wsRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        capturingRef.current = false
        return
      }
      mediaStreamRef.current = stream
      try {
        const ctx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })
        captureCtxRef.current = ctx
        // Browsers may ignore the requested 16 kHz and run the context at the
        // hardware rate (e.g. 48000). The wire format is fixed at PCM16 16 kHz —
        // resample each frame to the true target rate before encoding.
        const actualRate = ctx.sampleRate
        frameMsRef.current = (CAPTURE_BUFFER_SIZE / actualRate) * 1000
        vadStateRef.current = initialVadState
        const source = ctx.createMediaStreamSource(stream)
        captureSourceRef.current = source
        const proc = ctx.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1)
        captureProcRef.current = proc
        proc.onaudioprocess = (e) => {
          const frame = e.inputBuffer.getChannelData(0)
          // 1) VAD on the raw frame (energy is rate-independent), driving the
          //    conversation phase + barge-in.
          const rms = computeRms(frame)
          const stepped = vadStep(vadStateRef.current, rms, frameMsRef.current, DEFAULT_VAD_CONFIG)
          vadStateRef.current = stepped.state
          if (stepped.event === 'speech-start') onSpeechStart()
          else if (stepped.event === 'utterance-end') onUtteranceEnd()
          // 2) Stream the frame continuously as PCM16 16 kHz.
          const socket = wsRef.current
          if (!socket || socket.readyState !== WebSocket.OPEN) return
          const pcm =
            actualRate === CAPTURE_SAMPLE_RATE
              ? frame
              : resamplePcmFloat32(frame, actualRate, CAPTURE_SAMPLE_RATE)
          socket.send(floatTo16BitPCM(pcm))
        }
        source.connect(proc)
        proc.connect(ctx.destination)
      } catch {
        stopCapture()
        safeDispatch({ type: 'mic-error', message: 'microphone capture failed' })
      }
    })()
  }, [onSpeechStart, onUtteranceEnd, safeDispatch, stopCapture])

  // --- WebSocket lifecycle ---

  const closeSocket = useCallback((detachHandlers: boolean) => {
    const ws = wsRef.current
    wsRef.current = null
    if (!ws) return
    if (detachHandlers) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
    }
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }, [])

  const connect = useCallback(() => {
    // Double-connect guard: only one socket per mounted lifecycle.
    if (wsRef.current) return
    const data = manualDataRef.current
    if (!data) return
    endedRef.current = false
    sentSectionsRef.current = null
    safeDispatch({ type: 'connecting' })

    let ws: WebSocket
    try {
      ws = new WebSocket(buildSessionUrl(window.location, randomSessionName()))
    } catch {
      safeDispatch({ type: 'transport-error', message: 'failed to open voice connection' })
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      const create = {
        type: 'create' as const,
        gameId: gameIdRef.current,
        manualData: manualDataRef.current,
        gameState: gameStateRef.current,
        ...(gameRunIdRef.current ? { gameRunId: gameRunIdRef.current } : {}),
        // Only ride the streak when there IS one (>0): a fresh player's create
        // stays byte-identical, and the server maps a sub-week streak to the
        // newcomer tier (no tone change) regardless.
        ...(streakDaysRef.current !== undefined && streakDaysRef.current > 0
          ? { streakDays: streakDaysRef.current }
          : {}),
      }
      try {
        ws.send(JSON.stringify(create))
        // The first module's sections rode this `create`; record them so a later
        // module advance sends ONE `update-gamestate` (and the module the session
        // was created with never triggers a redundant steer).
        sentSectionsRef.current = sectionsSignature(gameStateRef.current)
      } catch {
        safeDispatch({ type: 'transport-error', message: 'failed to create voice session' })
      }
    }

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      let frame: ServerFrame
      try {
        frame = JSON.parse(event.data) as ServerFrame
      } catch {
        return
      }
      if (frame.type === 'created') {
        // The AI greets first: open the mic now and mark the opening greeting
        // pending (-> "thinking" until its audio plays).
        setAwaiting(true)
        startCapture()
        safeDispatch({ type: 'frame', frame })
        return
      }
      if (frame.type === 'chunk') {
        // Drop the tail of a turn the player barged in on, until its `done`.
        if (suppressTurnRef.current) {
          if (frame.done) {
            suppressTurnRef.current = false
            turnStreamingRef.current = false
          }
          return
        }
        // A real chunk arriving means the AI is responding now — the player's
        // wait is over.
        turnStreamingRef.current = !frame.done
        if (awaitingResponseRef.current) setAwaiting(false)
        if (frame.kind === 'audio' && frame.audio) {
          playAudioFrame(base64ToBytes(frame.audio))
        }
        safeDispatch({ type: 'frame', frame })
        // Closing-recap resolution: when the recap's terminal `done` chunk
        // arrives, flip `closingDoneRef`. If no audio frames are queued (a
        // text-only or zero-TTS edge case), resolve the promise immediately;
        // otherwise `source.onended` resolves it once the last frame drains.
        if (frame.done && closingInProgressRef.current) {
          closingDoneRef.current = true
          if (playingCountRef.current === 0) {
            const resolve = closingResolveRef.current
            if (resolve) {
              closingResolveRef.current = null
              closingInProgressRef.current = false
              closingDoneRef.current = false
              resolve()
            }
          }
        }
        return
      }
      if (frame.type === 'error') {
        // A benign in-band rejection leaves the socket open and must NOT read as
        // an error. The common one is `turn_in_flight` (our VAD raced the server's
        // own in-flight turn): release any pending "thinking" wait so the UI falls
        // back to listening. The reducer drops the benign codes, so no error line
        // shows; an unexpected code still surfaces through the reducer.
        if (frame.code === 'turn_in_flight' && awaitingResponseRef.current) setAwaiting(false)
        safeDispatch({ type: 'frame', frame })
        return
      }
      safeDispatch({ type: 'frame', frame })
    }

    ws.onerror = () => {
      safeDispatch({ type: 'transport-error', message: 'voice connection error' })
    }

    ws.onclose = (event) => {
      wsRef.current = null
      if (endedRef.current || event.code === 1000) {
        safeDispatch({ type: 'closed' })
      } else {
        // The server attaches a bounded `safeCloseReason` to every 1008 — surface
        // it so a residual failure is self-explaining, not a bare numeric code.
        const reason = event.reason ? `: ${event.reason}` : ''
        safeDispatch({
          type: 'transport-error',
          message: `voice connection closed (${event.code}${reason})`,
        })
      }
    }
  }, [playAudioFrame, safeDispatch, setAwaiting, startCapture])

  // --- Public actions ---

  const endSession = useCallback(() => {
    // Exactly-once: the settlement seam (GamePage's RESULT effect) and any
    // teardown path can both reach here, and a duplicate `{type:'end'}` would
    // double the server's memory-capture hand-off. `endedRef` — the same flag
    // the clean-close `onclose` reads — is set the instant `end` is sent, so a
    // second call is a no-op.
    if (endedRef.current) return
    stopCapture()
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Mark ended so the eventual close is treated as clean; let the socket stay
      // open to receive the `summary`, then its `onclose` finalizes to `closed`.
      endedRef.current = true
      try {
        ws.send(JSON.stringify({ type: 'end' }))
      } catch {
        closeSocket(true)
        safeDispatch({ type: 'closed' })
      }
    } else {
      closeSocket(true)
      safeDispatch({ type: 'closed' })
    }
  }, [stopCapture, closeSocket, safeDispatch])

  /**
   * Request the closing-recap turn from the DO. Returns a promise that resolves
   * when the recap audio has finished playing (all queued TTS frames drained
   * after the terminal `done` chunk), so the caller can gate results-screen
   * navigation on the player HEARING the recap. Resolves immediately if the
   * WebSocket is not open (no audio to wait for).
   *
   * Called once per successful daily defuse, from GamePage's RESULT effect.
   * GamePage applies its own hard-max timeout (~8 s) so a TTS hiccup never
   * strands the player on the win screen.
   */
  const requestClosing = useCallback((outcome?: RecapOutcome): Promise<void> => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      closingResolveRef.current = resolve
      closingInProgressRef.current = true
      closingDoneRef.current = false
      try {
        ws.send(JSON.stringify({ type: 'closing', ...(outcome ? { outcome } : {}) }))
      } catch {
        // Send failed — resolve immediately so the caller does not hang.
        closingResolveRef.current = null
        closingInProgressRef.current = false
        resolve()
      }
    })
  }, [])

  // --- Connect on mount (once the manual is ready); full teardown on unmount ---

  const hasManual = manualData !== null
  useEffect(() => {
    if (!hasManual) return
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (awaitingTimeoutRef.current) {
        clearTimeout(awaitingTimeoutRef.current)
        awaitingTimeoutRef.current = null
      }
      stopCapture()
      teardownPlayback()
      closeSocket(true)
    }
  }, [hasManual, connect, stopCapture, teardownPlayback, closeSocket])

  // --- Module advance within one run: steer the live session, never reconnect ---
  //
  // When `relevantSections` change AFTER the session is created (the player moved
  // to a new module), send ONE `update-gamestate` on the open socket so the
  // server injects the new module's manual subset for subsequent turns. The first
  // selection already rode the `create` message (`onopen` set `sentSectionsRef`),
  // so only a genuine later change sends here, exactly once. Gated on the `ready`
  // status (set on the `created` frame) so nothing is sent before the session
  // exists — never as a second `create`. The conversation, history, and greeting
  // are untouched; this only re-selects which manual sections the next turn sees.
  const liveSectionsSignature = sectionsSignature(gameState)
  useEffect(() => {
    if (state.status !== 'ready') return
    if (sentSectionsRef.current === liveSectionsSignature) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    sentSectionsRef.current = liveSectionsSignature
    try {
      ws.send(JSON.stringify({ type: 'update-gamestate', gameState: gameStateRef.current }))
    } catch {
      /* non-fatal — a dropped steer just leaves the next turn on the old sections */
    }
  }, [liveSectionsSignature, state.status])

  const conversationPhase = useMemo(
    () => deriveConversationPhase({ isAiSpeaking, playerSpeaking, awaitingResponse }),
    [isAiSpeaking, playerSpeaking, awaitingResponse]
  )

  return {
    status: state.status,
    conversationPhase,
    playerSpeaking,
    aiText: state.aiText,
    playerTranscript: state.playerTranscript,
    isAiSpeaking,
    error: state.error,
    // The shared reducer stores the summary as an opaque payload (keeping
    // `shared/` free of a workspace dependency); re-narrow to the concrete wire
    // `SessionSummary` here, at this package's boundary. The client only forwards
    // the value, so this assertion is the single place the type is recovered.
    summary: state.summary as import('@amiclaw/platform-ai/contract').SessionSummary | null,
    endSession,
    requestClosing,
  }
}
