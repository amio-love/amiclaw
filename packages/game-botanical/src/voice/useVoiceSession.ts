/**
 * `useVoiceSession` — the Botanical client for one platform-ai voice session,
 * hands-free full-duplex. Adapted from game-bombsquad's hook (the load-bearing
 * turn model / VAD / barge-in / mic / playback machinery is copied verbatim);
 * the bombsquad-only surface (closing-recap, account streak, score-settlement
 * gameRunId) is dropped — the botanical probe needs only the core contract:
 * create → speech-start → audio → turn → chunk → update-gamestate → end.
 *
 * Runs the whole conversation against the deployed `@amiclaw/platform-ai` Worker
 * over the same-origin `/ai-ws/*` WebSocket: connect → create session → open the
 * mic ONCE and stream PCM16 16 kHz frames continuously → the AI botanist greets
 * first and answers each utterance → render the AI's streamed text + play its TTS
 * audio → end session. There is NO push-to-talk; the player just talks.
 *
 * Turn model (important): the CLIENT runs the VAD. On `create` the server fires
 * the AI-first opening greeting (no client input). Thereafter the hook streams
 * the mic continuously; the client-side VAD detects utterance START and sends
 * `{type:'speech-start'}` (opens the recognizer to transcribe LIVE), then
 * end-of-utterance and sends `{type:'turn'}` (finalizes STT→LLM→TTS over the
 * audio buffered since the last turn). Turns are SERIAL server-side, so BOTH
 * sends fire only when the AI is idle — otherwise the open mic picking up the
 * AI's own greeting would open a spurious utterance / fire a rejected turn. The
 * one mid-stream exception is a genuine barge-in.
 *
 * Security invariant (load-bearing): connects ONLY to the same-origin Worker WS
 * and sends ONLY `{gameId, manualData, gameState}` plus binary audio. NO provider
 * key, NO system prompt, NO userId — the session cookie / DEV_AUTH_BYPASS
 * authenticates same-origin and the server holds every secret.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { GameState, ManualData } from '@amiclaw/platform-ai/contract'
import { base64ToBytes } from './audio-pcm'
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
import { createPcmCapture, type PcmCapture } from '@shared/voice/audio-capture'
import { createPcmPlayback, type PcmPlayback } from '@shared/voice/audio-playback'

/** Volcengine TTS output sample rate (`volcengine.ts` `DEFAULT_SAMPLE_RATE`). */
const TTS_OUTPUT_SAMPLE_RATE = 16000
/** Mic capture rate — the STT adapter's exact wire rate (PCM16 16 kHz mono). */
const CAPTURE_SAMPLE_RATE = 16000
/** ScriptProcessor buffer size (frames). Matches the demo. */
const CAPTURE_BUFFER_SIZE = 4096
/** Fallback out of `thinking` if a (no-speech / spurious-VAD) turn gets no reply. */
const NO_RESPONSE_TIMEOUT_MS = 12000

/** Stable signature of the manual-subset selection, for change detection. */
function sectionsSignature(gameState: GameState): string {
  return JSON.stringify(gameState.relevantSections ?? [])
}

export interface UseVoiceSessionOptions {
  /**
   * The per-run manual payload (built via `buildBotanicalManualData`). `null`
   * while the manual is still loading — the hook stays `idle` and connects once
   * a non-null value is provided.
   */
  manualData: ManualData | null
  /**
   * The game state driving manual-subset selection (`relevantSections` via
   * `gardenStateToRelevantSections`). The FIRST value rides the `create`
   * message; a later change is steered on the live socket with a single
   * `update-gamestate` (no reconnect, no re-greet).
   */
  gameState: GameState
  /** Platform game id. Defaults to `'demo-mock'` (the credential-free probe path). */
  gameId?: string
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
  /** The player's live recognized speech, streamed as recognition builds. */
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
   * Text fallback (FP1 A): send a typed question as a `text-turn` on the live
   * socket — the AI botanist replies over the same session, skipping STT. A
   * no-op if empty or not connected. The reply streams back through the same
   * `chunk`/`transcript` path a voice turn uses.
   */
  sendText: (text: string) => void
}

export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSessionResult {
  const { manualData, gameState, gameId = 'demo-mock' } = options

  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState)
  const [isAiSpeaking, setIsAiSpeaking] = useState(false)
  const [playerSpeaking, setPlayerSpeaking] = useState(false)
  const [awaitingResponse, setAwaitingResponse] = useState(false)
  const awaitingResponseRef = useRef(false)
  const awaitingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest inputs, captured at connect/create time without re-running connect.
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
  const sentSectionsRef = useRef<string | null>(null)
  const turnStreamingRef = useRef(false)
  const suppressTurnRef = useRef(false)

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

  // --- Imperative audio shells (TTS playback + mic capture) ---
  const [playback] = useState<PcmPlayback>(() => createPcmPlayback(TTS_OUTPUT_SAMPLE_RATE))
  const [capture] = useState<PcmCapture>(() =>
    createPcmCapture(CAPTURE_SAMPLE_RATE, CAPTURE_BUFFER_SIZE)
  )

  const onSpeakingChange = useCallback((speaking: boolean) => {
    if (speaking) setIsAiSpeaking(true)
    else if (mountedRef.current) setIsAiSpeaking(false)
  }, [])

  /** A VAD `utterance-end`: the player went silent after speaking. */
  const onUtteranceEnd = useCallback(() => {
    setPlayerSpeaking(false)
    // Only hand the floor to the server when the AI is idle (serial turns).
    const aiHoldsFloor =
      playback.isPlaying() ||
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
  }, [setAwaiting, playback])

  /** A VAD `speech-start`: the player began an utterance (incl. barge-in). */
  const onSpeechStart = useCallback(() => {
    const bargeIn = playback.isPlaying()
    if (bargeIn) {
      playback.interrupt(onSpeakingChange)
      if (turnStreamingRef.current) suppressTurnRef.current = true
      safeDispatch({ type: 'barge-in' })
    }
    // Guard the SAME way the `turn` send is guarded — only signal a REAL utterance.
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
        /* non-fatal — a dropped speech-start just defers live transcription to the turn */
      }
    }
  }, [playback, safeDispatch, onSpeakingChange])

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
      }
      try {
        ws.send(JSON.stringify(create))
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
        // The AI greets first: open the mic now and mark the greeting pending.
        setAwaiting(true)
        capture.start({
          onSpeechStart,
          onUtteranceEnd,
          onError: (message) => safeDispatch({ type: 'mic-error', message }),
          isMounted: () => mountedRef.current,
          getSocket: () => wsRef.current,
        })
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
        turnStreamingRef.current = !frame.done
        if (awaitingResponseRef.current) setAwaiting(false)
        if (frame.kind === 'audio' && frame.audio) {
          playback.play(base64ToBytes(frame.audio), onSpeakingChange)
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

    ws.onclose = (event) => {
      wsRef.current = null
      if (endedRef.current || event.code === 1000) {
        safeDispatch({ type: 'closed' })
      } else {
        const reason = event.reason ? `: ${event.reason}` : ''
        safeDispatch({
          type: 'transport-error',
          message: `voice connection closed (${event.code}${reason})`,
        })
      }
    }
  }, [
    capture,
    playback,
    onSpeechStart,
    onUtteranceEnd,
    onSpeakingChange,
    safeDispatch,
    setAwaiting,
  ])

  // --- Public actions ---

  const endSession = useCallback(() => {
    // Exactly-once: a duplicate `{type:'end'}` would double the server's
    // memory-capture hand-off. `endedRef` guards the second call.
    if (endedRef.current) return
    capture.stop()
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
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
  }, [capture, closeSocket, safeDispatch])

  /** Send a typed question as a `text-turn` (the text fallback). */
  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed === '') return
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ type: 'text-turn', text: trimmed }))
        // A typed question awaits a reply → drive the `thinking` phase; the first
        // reply chunk (or a turn_in_flight rejection, or the watchdog) clears it.
        setAwaiting(true)
      } catch {
        /* non-fatal — a dropped text-turn just goes unanswered */
      }
    },
    [setAwaiting]
  )

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
      capture.stop()
      playback.teardown(onSpeakingChange)
      closeSocket(true)
    }
  }, [hasManual, connect, capture, playback, onSpeakingChange, closeSocket])

  // --- Garden state advance within one run: steer the live session, no reconnect ---
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
    summary: state.summary as import('@amiclaw/platform-ai/contract').SessionSummary | null,
    endSession,
    sendText,
  }
}
