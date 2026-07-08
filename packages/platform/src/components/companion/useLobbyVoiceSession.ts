/**
 * `useLobbyVoiceSession` — the companion's manual-less voice session on the home
 * lobby (companion-presence-design §语音, auto-voice login sequence step 4).
 *
 * It is the sibling of the in-game `useVoiceSession` (`@amiclaw/game-bombsquad`),
 * sharing the game-agnostic voice-client core (`@shared/voice/*`) but stripped to
 * what a lobby greeting needs and hardened for a NON-game context:
 *
 *  - MANUAL-LESS create: `gameId:'companion-lobby'`, `manualData:{version:'lobby',
 *    sections:{}}`, `gameState:{relevantSections:[]}`, NO `gameRunId`. The server
 *    resolves the companion memory from the auth cookie and the AI greets first
 *    (`opening:true`). The greeting's streamed text drives the dock subtitle
 *    (design Option B — the instant client text bubble is replaced by the live
 *    voiced greeting as it streams).
 *
 *  - OPEN-DRIVEN lifecycle: unlike the in-game hook (connect-on-mount), this hook
 *    connects only when `open()` is called — from the auto-voice GRANT branch,
 *    after the permission probe already succeeded. `open(stream)` reuses the
 *    already-granted `MediaStream` from the probe so the browser is not prompted
 *    a second time; `open()` with no stream acquires its own.
 *
 *  - THREE-LAYER COST GUARD (design §成本姿态 — voice is a conversation, not
 *    background audio): a 30s silence timeout, a 3-player-turn cap, and a 90s hard
 *    maximum, whichever trips first ends the session. Ending is an ABRUPT socket
 *    close (NO `{type:'end'}`), so the server flushes usage but NEVER hands the
 *    lobby summary to the consolidator — lobby chit-chat must never become a
 *    memory (only a real game run, via the in-game hook's `end`, produces one).
 *
 * Security invariant (mirrors the in-game hook): connects ONLY to the same-origin
 * Worker WS, sends ONLY the create envelope + binary audio; NO provider key, NO
 * system prompt, NO userId — the session cookie authenticates same-origin.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { GameState, ManualData } from '@amiclaw/platform-ai/contract'
import {
  base64ToBytes,
  floatTo16BitPCM,
  pcm16ToFloat32,
  resamplePcmFloat32,
} from '@shared/voice/audio-pcm'
import {
  buildSessionUrl,
  deriveConversationPhase,
  initialVoiceState,
  voiceReducer,
  type ConversationPhase,
  type ServerFrame,
  type VoiceStatus,
} from '@shared/voice/voice-session-protocol'
import {
  computeRms,
  DEFAULT_VAD_CONFIG,
  initialVadState,
  vadStep,
  type VadState,
} from '@shared/voice/voice-vad'

const TTS_OUTPUT_SAMPLE_RATE = 16000
const CAPTURE_SAMPLE_RATE = 16000
const CAPTURE_BUFFER_SIZE = 4096
/** No-response watchdog: a spurious / no-speech turn yields no chunks and no done. */
const NO_RESPONSE_TIMEOUT_MS = 12000

/** Cost guard — layer 1: end after this much continuous idle silence. */
export const LOBBY_SILENCE_TIMEOUT_MS = 30_000
/** Cost guard — layer 2: end after this many completed player turns. */
export const LOBBY_MAX_PLAYER_TURNS = 3
/** Cost guard — layer 3: absolute session ceiling regardless of activity. */
export const LOBBY_MAX_DURATION_MS = 90_000

/** The empty manual a lobby session carries — there is no game here. */
const LOBBY_MANUAL: ManualData = { version: 'lobby', sections: {} }
const LOBBY_GAME_STATE: GameState = { relevantSections: [] }
const LOBBY_GAME_ID = 'companion-lobby'

/** Why the lobby session ended — surfaced for callers / instrumentation. */
export type LobbyEndReason = 'silence' | 'turn-cap' | 'max-duration' | 'caller' | 'mic-denied'

function randomLobbySessionName(): string {
  return `lobby-${Math.random().toString(36).slice(2, 10)}`
}

function closeAudioContext(ctx: AudioContext | null): void {
  if (!ctx) return
  try {
    const closing = ctx.close()
    if (closing && typeof closing.then === 'function') {
      closing.catch(() => {})
    }
  } catch {
    /* already closed */
  }
}

export interface UseLobbyVoiceSessionResult {
  /** Socket lifecycle status. */
  status: VoiceStatus
  /** True while the session is live (`ready`). */
  live: boolean
  /** In-conversation 3-state phase for a live session. */
  conversationPhase: ConversationPhase
  /** Accumulated AI text for the current turn (drives the dock subtitle). */
  aiText: string
  /** True while TTS audio is scheduled / playing. */
  isAiSpeaking: boolean
  /**
   * Open the lobby session. Optionally reuse an already-granted `MediaStream`
   * (from the auto-voice permission probe) so the mic is not re-requested. A
   * no-op if a session is already open.
   */
  open: (stream?: MediaStream) => void
  /**
   * Close the session immediately via an ABRUPT socket close (never `end`, so no
   * memory capture). Idempotent. `reason` is instrumentation only.
   */
  close: (reason?: LobbyEndReason) => void
}

export function useLobbyVoiceSession(): UseLobbyVoiceSessionResult {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState)
  const [isAiSpeaking, setIsAiSpeaking] = useState(false)
  const [playerSpeaking, setPlayerSpeaking] = useState(false)
  const [awaitingResponse, setAwaitingResponse] = useState(false)
  const awaitingResponseRef = useRef(false)
  const awaitingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)
  /** A pre-granted stream handed to `open()`; consumed once by `startCapture`. */
  const pendingStreamRef = useRef<MediaStream | null>(null)

  const mediaStreamRef = useRef<MediaStream | null>(null)
  const captureCtxRef = useRef<AudioContext | null>(null)
  const captureSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const captureProcRef = useRef<ScriptProcessorNode | null>(null)
  const capturingRef = useRef(false)
  const vadStateRef = useRef<VadState>(initialVadState)
  const frameMsRef = useRef<number>((CAPTURE_BUFFER_SIZE / CAPTURE_SAMPLE_RATE) * 1000)

  const playbackCtxRef = useRef<AudioContext | null>(null)
  const playbackCursorRef = useRef(0)
  const playingCountRef = useRef(0)
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const turnStreamingRef = useRef(false)
  const suppressTurnRef = useRef(false)

  // --- Cost guard state ---
  /** Completed player turns (each `turn` we actually send). */
  const playerTurnsRef = useRef(0)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      awaitingTimeoutRef.current = setTimeout(() => {
        awaitingTimeoutRef.current = null
        awaitingResponseRef.current = false
        if (mountedRef.current) setAwaitingResponse(false)
      }, NO_RESPONSE_TIMEOUT_MS)
    }
  }, [])

  // --- TTS playback ---
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
        }
      } catch {
        /* a playback failure must never break the turn — text still renders */
      }
    },
    [ensurePlaybackCtx]
  )

  const interruptPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        // eslint-disable-next-line react-hooks/immutability -- Web Audio node in a ref; detach before stop to avoid re-entering onended bookkeeping.
        source.onended = null
        source.stop?.()
        source.disconnect?.()
      } catch {
        /* already ended */
      }
    }
    activeSourcesRef.current.clear()
    playingCountRef.current = 0
    playbackCursorRef.current = playbackCtxRef.current?.currentTime ?? 0
    if (mountedRef.current) setIsAiSpeaking(false)
  }, [])

  const teardownPlayback = useCallback(() => {
    interruptPlayback()
    const ctx = playbackCtxRef.current
    playbackCtxRef.current = null
    playbackCursorRef.current = 0
    closeAudioContext(ctx)
  }, [interruptPlayback])

  // --- Mic capture ---
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

  const onUtteranceEnd = useCallback(() => {
    setPlayerSpeaking(false)
    const aiHoldsFloor =
      playingCountRef.current > 0 ||
      awaitingResponseRef.current ||
      (turnStreamingRef.current && !suppressTurnRef.current)
    if (aiHoldsFloor) return
    setAwaiting(true)
    playerTurnsRef.current += 1
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'turn' }))
      } catch {
        /* non-fatal */
      }
    }
  }, [setAwaiting])

  const onSpeechStart = useCallback(() => {
    const bargeIn = playingCountRef.current > 0
    if (bargeIn) {
      interruptPlayback()
      if (turnStreamingRef.current) suppressTurnRef.current = true
      safeDispatch({ type: 'barge-in' })
    }
    const aiHoldsFloor =
      !bargeIn &&
      (awaitingResponseRef.current || (turnStreamingRef.current && !suppressTurnRef.current))
    if (aiHoldsFloor) return
    setPlayerSpeaking(true)
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'speech-start' }))
      } catch {
        /* non-fatal */
      }
    }
  }, [interruptPlayback, safeDispatch])

  const startCapture = useCallback(() => {
    if (capturingRef.current) return
    capturingRef.current = true
    void (async () => {
      let stream: MediaStream
      const preGranted = pendingStreamRef.current
      pendingStreamRef.current = null
      if (preGranted) {
        stream = preGranted
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          })
        } catch {
          capturingRef.current = false
          safeDispatch({ type: 'mic-error', message: 'microphone permission denied' })
          return
        }
      }
      if (!mountedRef.current || !wsRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        capturingRef.current = false
        return
      }
      mediaStreamRef.current = stream
      try {
        const ctx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })
        captureCtxRef.current = ctx
        const actualRate = ctx.sampleRate
        frameMsRef.current = (CAPTURE_BUFFER_SIZE / actualRate) * 1000
        vadStateRef.current = initialVadState
        const source = ctx.createMediaStreamSource(stream)
        captureSourceRef.current = source
        const proc = ctx.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1)
        captureProcRef.current = proc
        proc.onaudioprocess = (e) => {
          const frame = e.inputBuffer.getChannelData(0)
          const rms = computeRms(frame)
          const stepped = vadStep(vadStateRef.current, rms, frameMsRef.current, DEFAULT_VAD_CONFIG)
          vadStateRef.current = stepped.state
          if (stepped.event === 'speech-start') onSpeechStart()
          else if (stepped.event === 'utterance-end') onUtteranceEnd()
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

  // --- Guard timers ---
  const clearGuardTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current)
      maxDurationTimerRef.current = null
    }
  }, [])

  const closeSocketOnly = useCallback((detachHandlers: boolean) => {
    const ws = wsRef.current
    wsRef.current = null
    if (!ws) return
    if (detachHandlers) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
    }
    // ABRUPT close — no `{type:'end'}`. The server flushes usage on the owner
    // socket close but does NOT hand off a summary, so a lobby chat never becomes
    // a memory (design §成本姿态 / the no-capture guarantee).
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }, [])

  const close = useCallback(
    (_reason: LobbyEndReason = 'caller') => {
      clearGuardTimers()
      if (awaitingTimeoutRef.current) {
        clearTimeout(awaitingTimeoutRef.current)
        awaitingTimeoutRef.current = null
      }
      stopCapture()
      teardownPlayback()
      const hadSocket = wsRef.current !== null
      closeSocketOnly(true)
      awaitingResponseRef.current = false
      if (mountedRef.current) {
        setAwaitingResponse(false)
        setPlayerSpeaking(false)
      }
      if (hadSocket) safeDispatch({ type: 'closed' })
    },
    [clearGuardTimers, stopCapture, teardownPlayback, closeSocketOnly, safeDispatch]
  )

  const open = useCallback(
    (stream?: MediaStream) => {
      if (wsRef.current) {
        // Already open; release a stream the caller handed in (avoid a leak).
        if (stream) stream.getTracks().forEach((t) => t.stop())
        return
      }
      pendingStreamRef.current = stream ?? null
      playerTurnsRef.current = 0
      suppressTurnRef.current = false
      turnStreamingRef.current = false
      safeDispatch({ type: 'connecting' })

      let ws: WebSocket
      try {
        ws = new WebSocket(buildSessionUrl(window.location, randomLobbySessionName()))
      } catch {
        pendingStreamRef.current = null
        if (stream) stream.getTracks().forEach((t) => t.stop())
        safeDispatch({ type: 'transport-error', message: 'failed to open voice connection' })
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        try {
          ws.send(
            JSON.stringify({
              type: 'create',
              gameId: LOBBY_GAME_ID,
              manualData: LOBBY_MANUAL,
              gameState: LOBBY_GAME_STATE,
              opening: true,
            })
          )
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
          setAwaiting(true)
          startCapture()
          safeDispatch({ type: 'frame', frame })
          return
        }
        if (frame.type === 'chunk') {
          if (suppressTurnRef.current) {
            if (frame.done) {
              suppressTurnRef.current = false
              turnStreamingRef.current = false
            }
            return
          }
          turnStreamingRef.current = !frame.done
          if (awaitingResponseRef.current) setAwaiting(false)
          if (frame.kind === 'audio' && frame.audio) {
            playAudioFrame(base64ToBytes(frame.audio))
          }
          safeDispatch({ type: 'frame', frame })
          return
        }
        if (frame.type === 'error') {
          if (frame.code === 'turn_in_flight' && awaitingResponseRef.current) setAwaiting(false)
          safeDispatch({ type: 'frame', frame })
          return
        }
        safeDispatch({ type: 'frame', frame })
      }

      ws.onerror = () => {
        safeDispatch({ type: 'transport-error', message: 'voice connection error' })
      }

      ws.onclose = () => {
        wsRef.current = null
        safeDispatch({ type: 'closed' })
      }

      // Guard layer 3: hard-max duration from open.
      maxDurationTimerRef.current = setTimeout(() => {
        maxDurationTimerRef.current = null
        close('max-duration')
      }, LOBBY_MAX_DURATION_MS)
    },
    [safeDispatch, setAwaiting, startCapture, playAudioFrame, close]
  )

  const conversationPhase = useMemo(
    () => deriveConversationPhase({ isAiSpeaking, playerSpeaking, awaitingResponse }),
    [isAiSpeaking, playerSpeaking, awaitingResponse]
  )

  const live = state.status === 'ready'

  // A mic denial after `create` (permission revoked / no device) surfaces as a
  // `mic-error`; a lobby session with no mic cannot converse, so end it (the
  // caller maps this to the denied-remembered posture).
  useEffect(() => {
    if (state.error && live) {
      close('mic-denied')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.error])

  // Guard layers 1 + 2: when the session is fully idle (listening for the player,
  // nobody speaking), either the turn cap has been reached → end now, or arm the
  // silence timeout. Any activity (AI speaking, player speaking, a pending reply)
  // clears the countdown. Reruns on every phase change so the timer always
  // reflects the live conversation.
  useEffect(() => {
    if (!live) return
    const idle = conversationPhase === 'listening' && !playerSpeaking
    if (!idle) {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      return
    }
    if (playerTurnsRef.current >= LOBBY_MAX_PLAYER_TURNS) {
      close('turn-cap')
      return
    }
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null
      close('silence')
    }, LOBBY_SILENCE_TIMEOUT_MS)
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
    }
  }, [live, conversationPhase, playerSpeaking, close])

  // Full teardown on unmount.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearGuardTimers()
      if (awaitingTimeoutRef.current) {
        clearTimeout(awaitingTimeoutRef.current)
        awaitingTimeoutRef.current = null
      }
      stopCapture()
      teardownPlayback()
      closeSocketOnly(true)
    }
  }, [clearGuardTimers, stopCapture, teardownPlayback, closeSocketOnly])

  return {
    status: state.status,
    live,
    conversationPhase,
    aiText: state.aiText,
    isAiSpeaking,
    open,
    close,
  }
}
