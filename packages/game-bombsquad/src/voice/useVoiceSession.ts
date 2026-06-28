/**
 * `useVoiceSession` — the BombSquad client for one platform-ai voice session.
 *
 * Runs the whole turn lifecycle against the deployed `@amiclaw/platform-ai` Worker
 * over the same-origin `/ai-ws/*` WebSocket: connect -> create session -> hold-to-
 * talk PCM16 mic capture -> drive a turn -> render the AI's streamed text + play
 * its TTS audio -> end session. This round is the hook (logic + state) only; the
 * voice-panel UI + GamePage wiring land in the next round, but the API is shaped
 * for a panel to consume directly.
 *
 * Security invariant (load-bearing, mirrors the demo): this hook connects ONLY to
 * the same-origin Worker WS and sends ONLY `{gameId, manualData, gameState}` plus
 * binary audio. It carries NO provider key, NO system prompt, and NO userId — the
 * session cookie authenticates same-origin and the server holds every secret.
 *
 * Audio formats (both 16 kHz mono PCM16):
 *  - mic capture: `AudioContext({ sampleRate: 16000 })` + `ScriptProcessorNode`,
 *    Float32 -> Int16 LE per frame (`floatTo16BitPCM`), sent as binary WS frames.
 *    ScriptProcessor is deprecated but is what the demo uses and is sufficient
 *    here (capture parity; see the directive's note).
 *  - TTS playback: base64 audio frame -> Int16 LE -> Float32 (`pcm16ToFloat32`),
 *    wrapped in an `AudioBuffer` at 16000 Hz and scheduled gaplessly. 16000 is the
 *    Volcengine TTS output rate (`volcengine.ts` `DEFAULT_SAMPLE_RATE`, which the
 *    factory never overrides). The playback `AudioContext` runs at its native rate
 *    and resamples the 16 kHz buffers, which is robust across platforms that
 *    refuse a forced 16 kHz output context.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { GameState, ManualData } from '@amiclaw/platform-ai/contract'
import { base64ToBytes, floatTo16BitPCM, pcm16ToFloat32, resamplePcmFloat32 } from './audio-pcm'
import {
  buildSessionUrl,
  initialVoiceState,
  randomSessionName,
  voiceReducer,
  type ServerFrame,
  type VoiceStatus,
} from './voice-session-protocol'

/** Volcengine TTS output sample rate (`volcengine.ts` `DEFAULT_SAMPLE_RATE`). */
const TTS_OUTPUT_SAMPLE_RATE = 16000
/** Mic capture rate — the STT adapter's exact wire rate (PCM16 16 kHz mono). */
const CAPTURE_SAMPLE_RATE = 16000
/** ScriptProcessor buffer size (frames). Matches the demo. */
const CAPTURE_BUFFER_SIZE = 4096

/**
 * Close an `AudioContext` and release its hardware resources, swallowing the
 * (possible) rejection. Browsers cap the number of concurrent `AudioContext`s,
 * so a leaked context across turns / panel remounts eventually starves the next
 * `new AudioContext(...)` — which is the failure this hardening guards against.
 * Release is initiated synchronously by `close()`; React's cleanup contract
 * forbids a top-level `await`, so the returned promise is only used to discard a
 * rejection (a context already closing).
 */
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
  /**
   * The per-run manual payload (built via `bombsquadManualToManualData`). `null`
   * while the manual is still loading — the hook stays `idle` and connects once a
   * non-null value is provided.
   */
  manualData: ManualData | null
  /**
   * The game state driving manual-subset selection (`relevantSections` via
   * `moduleKindToRelevantSections`). Applied at session-create time; see the
   * module-change note on the return type.
   */
  gameState: GameState
  /** Platform game id. Defaults to `'bombsquad'`. */
  gameId?: string
}

export interface UseVoiceSessionResult {
  /** Connection / turn status for the panel. */
  status: VoiceStatus
  /** Accumulated AI text for the current turn. */
  aiText: string
  /** True while TTS audio is scheduled/playing. */
  isAiSpeaking: boolean
  /** Last bounded error message, or null. */
  error: string | null
  /** Session summary, set once the session ends cleanly. */
  summary: import('@amiclaw/platform-ai/contract').SessionSummary | null
  /** Begin push-to-talk capture (pointer-down). No-op unless `status === 'ready'`. */
  startTalking: () => void
  /** End push-to-talk, flush audio, and request the AI turn (pointer-up/leave). */
  stopTalking: () => void
  /** End the session: send `end`, await the summary, and tear down. */
  endSession: () => void
}

/**
 * Module-change / `gameState` updates: the wire protocol exposes no mid-session
 * `gameState` update message (only `create` / `turn` / `end`, and a re-`create` is
 * rejected `already_created`), so `relevantSections` are pinned at the value
 * captured when the session is created. The hook keeps the LATEST `gameState`/
 * `manualData` in refs and applies them at create time; to inject a new module's
 * sections the consumer creates a fresh session (remount / toggle the hosting
 * panel), which the next round decides. Within one live session, turns reuse the
 * created sections — documented as the chosen "carry, apply at create" behaviour.
 */
export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSessionResult {
  const { manualData, gameState, gameId = 'bombsquad' } = options

  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState)
  const [isAiSpeaking, setIsAiSpeaking] = useState(false)

  // Latest inputs, captured at connect/create time without re-running the connect
  // effect on every prop identity change. Synced in an effect (not during render)
  // so the refs are current by the time any event handler / connect effect reads
  // them, without the lint-flagged ref-write-during-render anti-pattern.
  const manualDataRef = useRef<ManualData | null>(manualData)
  const gameStateRef = useRef<GameState>(gameState)
  const gameIdRef = useRef<string>(gameId)
  useEffect(() => {
    manualDataRef.current = manualData
    gameStateRef.current = gameState
    gameIdRef.current = gameId
  })

  // Side-effect handles (never trigger re-render).
  const wsRef = useRef<WebSocket | null>(null)
  const endedRef = useRef(false)
  const mountedRef = useRef(true)

  const mediaStreamRef = useRef<MediaStream | null>(null)
  const captureCtxRef = useRef<AudioContext | null>(null)
  const captureSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const captureProcRef = useRef<ScriptProcessorNode | null>(null)
  /** True between a successful mic acquire and `stopTalking` — gates the `turn`. */
  const capturingRef = useRef(false)
  /** True the instant `startTalking` runs; cleared by `stopTalking`, so a release
   *  during the async `getUserMedia` aborts the capture that is still spinning up. */
  const talkRequestedRef = useRef(false)

  const playbackCtxRef = useRef<AudioContext | null>(null)
  /** Next scheduled playback start time, for gapless PCM frame queueing. */
  const playbackCursorRef = useRef(0)
  /** Count of scheduled-but-not-ended buffers, driving `isAiSpeaking`. */
  const playingCountRef = useRef(0)

  const safeDispatch = useCallback((action: Parameters<typeof dispatch>[0]) => {
    if (mountedRef.current) dispatch(action)
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
        setIsAiSpeaking(true)
        source.onended = () => {
          playingCountRef.current = Math.max(0, playingCountRef.current - 1)
          if (playingCountRef.current === 0 && mountedRef.current) setIsAiSpeaking(false)
        }
      } catch {
        // A playback failure must never break the turn — text still renders.
      }
    },
    [ensurePlaybackCtx]
  )

  const stopPlayback = useCallback(() => {
    playingCountRef.current = 0
    playbackCursorRef.current = 0
    setIsAiSpeaking(false)
    const ctx = playbackCtxRef.current
    playbackCtxRef.current = null
    closeAudioContext(ctx)
  }, [])

  // --- Mic capture ---

  const stopCapture = useCallback(() => {
    capturingRef.current = false
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
      }
      try {
        ws.send(JSON.stringify(create))
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
      if (frame.type === 'chunk' && frame.kind === 'audio' && frame.audio) {
        playAudioFrame(base64ToBytes(frame.audio))
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
        // The server attaches a bounded `safeCloseReason` to every 1008 (e.g.
        // "turn before create", a provider error code) — surface it so a residual
        // failure is self-explaining instead of a bare numeric code.
        const reason = event.reason ? `: ${event.reason}` : ''
        safeDispatch({
          type: 'transport-error',
          message: `voice connection closed (${event.code}${reason})`,
        })
      }
    }
  }, [playAudioFrame, safeDispatch])

  // --- Public actions ---

  const startTalking = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    // Only one turn at a time, and only once the session is ready.
    if (state.status !== 'ready' || talkRequestedRef.current) return
    talkRequestedRef.current = true

    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        talkRequestedRef.current = false
        safeDispatch({ type: 'mic-error', message: 'microphone permission denied' })
        return
      }
      // A release (stopTalking) during the async acquire aborts spin-up.
      if (!talkRequestedRef.current || !wsRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      mediaStreamRef.current = stream
      try {
        const ctx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })
        captureCtxRef.current = ctx
        // Browsers may ignore the requested 16 kHz and run the context at the
        // hardware rate (e.g. 48000). The wire format is fixed at PCM16 16 kHz —
        // resample each frame to the true target rate before encoding, so we
        // never send mislabelled (wrong-rate) audio that the STT rejects (1008).
        const actualRate = ctx.sampleRate
        const source = ctx.createMediaStreamSource(stream)
        captureSourceRef.current = source
        const proc = ctx.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1)
        captureProcRef.current = proc
        proc.onaudioprocess = (e) => {
          const socket = wsRef.current
          if (!socket || socket.readyState !== WebSocket.OPEN) return
          const frame = e.inputBuffer.getChannelData(0)
          const pcm =
            actualRate === CAPTURE_SAMPLE_RATE
              ? frame
              : resamplePcmFloat32(frame, actualRate, CAPTURE_SAMPLE_RATE)
          socket.send(floatTo16BitPCM(pcm))
        }
        source.connect(proc)
        proc.connect(ctx.destination)
        capturingRef.current = true
        safeDispatch({ type: 'talk-start' })
      } catch {
        stopCapture()
        talkRequestedRef.current = false
        safeDispatch({ type: 'mic-error', message: 'microphone capture failed' })
      }
    })()
  }, [state.status, safeDispatch, stopCapture])

  const stopTalking = useCallback(() => {
    talkRequestedRef.current = false
    const wasCapturing = capturingRef.current
    stopCapture()
    const ws = wsRef.current
    // Only request a turn if we actually captured audio — an empty turn would
    // drive STT over a silent bridge.
    if (wasCapturing && ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'turn' }))
      } catch {
        safeDispatch({ type: 'transport-error', message: 'failed to send turn' })
      }
    }
  }, [stopCapture, safeDispatch])

  const endSession = useCallback(() => {
    talkRequestedRef.current = false
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

  // --- Connect on mount (once the manual is ready); full teardown on unmount ---

  const hasManual = manualData !== null
  useEffect(() => {
    if (!hasManual) return
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      stopCapture()
      stopPlayback()
      closeSocket(true)
    }
  }, [hasManual, connect, stopCapture, stopPlayback, closeSocket])

  return {
    status: state.status,
    aiText: state.aiText,
    isAiSpeaking,
    error: state.error,
    summary: state.summary,
    startTalking,
    stopTalking,
    endSession,
  }
}
