/**
 * Shared full-duplex client for one authenticated platform-ai game session.
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
import { base64ToBytes } from './audio-pcm'
import {
  buildSessionUrl,
  deriveConversationPhase,
  initialVoiceState,
  voiceReducer,
  type CoBuildAction,
  type ConversationPhase,
  type ServerFrame,
  type VoiceStatus,
} from './voice-session-protocol'
import { createPcmCapture, type PcmCapture } from './audio-capture'
import { createPcmPlayback, type PcmPlayback } from './audio-playback'

export interface GameVoiceManualData {
  version: string
  sections: Record<string, unknown>
}

export interface GameVoiceState {
  relevantSections: string[]
  publicContext?: unknown
}

export type GameVoiceRecapOutcome = 'defused' | 'exploded' | 'timeout'

export type GameVoiceErrorCode =
  | 'connect-timeout'
  | 'response-timeout'
  | 'silence-timeout'
  | 'turn-limit'
  | 'duration-limit'
  | 'microphone'
  | 'transport'
  | 'server'

export interface GameVoiceGuards {
  connectMs: number
  responseMs: number
  silenceMs: number
  maxPlayerTurns: number
  maxDurationMs: number
}

export const SHADOW_CHASE_VOICE_GUARDS: GameVoiceGuards = {
  connectMs: 5_000,
  responseMs: 12_000,
  silenceMs: 30_000,
  maxPlayerTurns: 8,
  maxDurationMs: 180_000,
}

/** Maximum wait for the server's terminal summary after a successful `end` send. */
export const GAME_VOICE_END_ACK_TIMEOUT_MS = 5_000

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
 * Client-side cap on a typed `text-turn` (see `sendText`), matching the server's
 * own truncation in `session-do.ts` (`MAX_TEXT_TURN_CHARS`). A game may cap
 * tighter at its input (e.g. the botanical TextPanel's visible `maxLength`); this
 * is the hard ceiling the hook never exceeds even if a consumer bypasses it.
 */
const TEXT_TURN_MAX_CHARS = 2000

function randomSessionName(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Stable signature of the manual-subset selection, for change detection across
 * renders. A new selection (the player advanced modules) yields a different
 * string; an unchanged selection (a timer-frame re-render) yields the same one,
 * so the `update-gamestate` steer fires exactly once per real module change.
 */
function gameStateSignature(gameState: GameVoiceState): string {
  return JSON.stringify(gameState)
}

export interface UseGameVoiceSessionOptions {
  /** Stable per-run join key shared by voice summary and score settlement. */
  gameRunId?: string
  /**
   * The per-run manual payload (built via `bombsquadManualToManualData`). `null`
   * while the manual is still loading — the hook stays `idle` and connects once a
   * non-null value is provided.
   */
  manualData: GameVoiceManualData | null
  /**
   * The game state driving manual-subset selection (`relevantSections` via
   * `moduleKindToRelevantSections`). The FIRST value rides the `create` message;
   * a later change (the player advanced modules within one run) is steered on the
   * live socket with a single `update-gamestate` — see the module-change note on
   * the return type.
   */
  gameState: GameVoiceState
  /** Platform game id. Defaults to `'bombsquad'`. */
  gameId?: string
  /**
   * The player's current arcade streak in days (B9 叙事型成长). Rides the
   * `create` message so the companion's tone follows the relationship's age
   * (register + memory budget). Omitted / 0 leaves the session byte-identical to
   * the pre-B9 behaviour.
   */
  streakDays?: number
  /** Connect immediately when the manual is ready. BombSquad keeps this default. */
  autoConnect?: boolean
  /** Prefix for the opaque same-origin session path. Defaults to `gameId`. */
  sessionNamePrefix?: string
  /** Whether the server should speak first. Defaults to true. */
  opening?: boolean
  /** Optional Shadow-style lifecycle/cost guards. */
  guards?: GameVoiceGuards
  /** Read the freshest bounded game state immediately before an utterance. */
  getGameState?: () => GameVoiceState
  /** Called once for the terminal transcript frame of each player utterance. */
  onFinalTranscript?: (utterance: { sequence: number; text: string }) => void
  /**
   * Called with the partner's structured board moves when a co_build game's server
   * emits an `action` frame. This is the SOLE handling path for `action` frames —
   * they never enter `voiceReducer`. Omitted by every non-co_build consumer
   * (BombSquad / botanical / shadow-chase / lobby), for whom an `action` frame (which
   * their server never sends anyway) is a no-op.
   */
  onAction?: (actions: CoBuildAction[]) => void
}

export interface UseGameVoiceSessionResult {
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
  /** Stable bounded error code for game-local Chinese presentation. */
  errorCode: GameVoiceErrorCode | null
  /** Session summary, set once the session ends cleanly. */
  summary: unknown | null
  /** Explicit user-gesture open path; a pre-granted mic stream is reused once. */
  openSession: (stream?: MediaStream) => void
  /** Abruptly stop voice without creating a companion-memory summary. */
  closeSession: () => void
  /** Push one bounded material game-state update on the live socket. */
  updateGameState: (next: GameVoiceState) => void
  /**
   * Text fallback: send a typed question as a `text-turn` on the live socket — the
   * AI replies over the same session, skipping STT. No-op if empty or not
   * connected. The reply streams back through the same `chunk`/`transcript` path a
   * voice turn uses.
   */
  sendText: (text: string) => void
  /** End the session: send `end`, await the summary, and tear down. */
  endSession: () => void
  /**
   * Request the closing-recap turn. Sends `{type:'closing', outcome}` to the DO,
   * which runs one final outcome-aware LLM+TTS recap and streams it back
   * (`defused` = warm congratulation, `exploded` / `timeout` = facts-only). The
   * returned promise resolves when the recap audio has finished playing (all
   * queued TTS frames drained). Resolves immediately if the socket is not open.
   */
  requestClosing: (outcome?: GameVoiceRecapOutcome) => Promise<void>
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
export function useGameVoiceSession(
  options: UseGameVoiceSessionOptions
): UseGameVoiceSessionResult {
  const {
    gameRunId,
    manualData,
    gameState,
    gameId = 'bombsquad',
    streakDays,
    autoConnect = true,
    sessionNamePrefix = gameId,
    opening = true,
    guards,
    getGameState,
    onFinalTranscript,
    onAction,
  } = options

  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState)
  const [isAiSpeaking, setIsAiSpeaking] = useState(false)
  const [errorCode, setErrorCode] = useState<GameVoiceErrorCode | null>(null)
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
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const durationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endAckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playerTurnsRef = useRef(0)
  const turnLimitPendingRef = useRef(false)
  const finalDeliveredRef = useRef(false)
  const utteranceSequenceRef = useRef(0)
  const guardCloseRef = useRef<(code: GameVoiceErrorCode) => void>(() => undefined)

  // Latest inputs, captured at connect/create time without re-running the connect
  // effect on every prop identity change.
  const manualDataRef = useRef<GameVoiceManualData | null>(manualData)
  const gameStateRef = useRef<GameVoiceState>(gameState)
  const gameIdRef = useRef<string>(gameId)
  const gameRunIdRef = useRef<string | undefined>(gameRunId)
  const streakDaysRef = useRef<number | undefined>(streakDays)
  const getGameStateRef = useRef(getGameState)
  const onFinalTranscriptRef = useRef(onFinalTranscript)
  const onActionRef = useRef(onAction)
  useEffect(() => {
    manualDataRef.current = manualData
    gameStateRef.current = gameState
    gameIdRef.current = gameId
    gameRunIdRef.current = gameRunId
    streakDaysRef.current = streakDays
    getGameStateRef.current = getGameState
    onFinalTranscriptRef.current = onFinalTranscript
    onActionRef.current = onAction
  })

  // Side-effect handles (never trigger re-render).
  const wsRef = useRef<WebSocket | null>(null)
  const pendingStreamRef = useRef<MediaStream | null>(null)
  const captureEpochRef = useRef(0)
  const openedRef = useRef(false)
  const endedRef = useRef(false)
  const mountedRef = useRef(true)
  /**
   * The `relevantSections` signature already communicated to the live session —
   * set when `create` is sent (the first selection rides that message) and after
   * each `update-gamestate`. A module advance whose new signature differs from
   * this sends exactly one steer; `null` until the session is being created.
   */
  const sentSectionsRef = useRef<string | null>(null)

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

  const clearGuardTimers = useCallback(() => {
    for (const ref of [connectTimeoutRef, silenceTimeoutRef, durationTimeoutRef]) {
      if (ref.current) clearTimeout(ref.current)
      ref.current = null
    }
  }, [])

  const clearEndAckTimeout = useCallback(() => {
    if (!endAckTimeoutRef.current) return
    clearTimeout(endAckTimeoutRef.current)
    endAckTimeoutRef.current = null
  }, [])

  const updateGameState = useCallback((next: GameVoiceState) => {
    gameStateRef.current = next
    const signature = gameStateSignature(next)
    if (sentSectionsRef.current === signature) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || sentSectionsRef.current === null) return
    sentSectionsRef.current = signature
    try {
      ws.send(JSON.stringify({ type: 'update-gamestate', gameState: next }))
    } catch {
      /* A dropped context steer never affects game authority. */
    }
  }, [])

  const armSilenceGuard = useCallback(() => {
    if (!guards) return
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current)
    silenceTimeoutRef.current = setTimeout(
      () => guardCloseRef.current('silence-timeout'),
      guards.silenceMs
    )
  }, [guards])

  const clearSilenceGuard = useCallback(() => {
    if (!silenceTimeoutRef.current) return
    clearTimeout(silenceTimeoutRef.current)
    silenceTimeoutRef.current = null
  }, [])

  const setAwaiting = useCallback(
    (v: boolean) => {
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
          if (guards) guardCloseRef.current('response-timeout')
        }, guards?.responseMs ?? NO_RESPONSE_TIMEOUT_MS)
      }
    },
    [guards]
  )

  const sendText = useCallback(
    (text: string) => {
      // Text fallback: a typed question rides a `text-turn` (server feeds the LLM
      // directly, skipping STT) on the SAME live socket, so the reply streams back
      // through the same `chunk`/`transcript` path a voice turn uses. Trim + cap
      // to the server's ceiling; no-op if empty or not connected. Additive to the
      // hook — voice-only consumers (bombsquad/shadow-chase) never call it.
      const trimmed = text.trim().slice(0, TEXT_TURN_MAX_CHARS)
      if (trimmed === '') return
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      // A typed question awaits a reply → drive the `thinking` phase; the first
      // reply chunk (or a turn_in_flight rejection, or the watchdog) clears it.
      setAwaiting(true)
      try {
        ws.send(JSON.stringify({ type: 'text-turn', text: trimmed }))
      } catch {
        /* non-fatal — a dropped text-turn just goes unanswered */
      }
    },
    [setAwaiting]
  )

  // --- Imperative audio shells (TTS playback + mic capture) ---
  //
  // The game-agnostic Web Audio plumbing lives in `@shared/voice/*`; both this
  // hook and the lobby hook drive ONE implementation. Each controller is a PURE
  // state machine built once via a `useState` lazy initializer from numeric
  // config alone (no ref access during render); the ref-reading lifecycle
  // callbacks are supplied at CALL time, all in event-handler contexts.

  const [playback] = useState<PcmPlayback>(() => createPcmPlayback(TTS_OUTPUT_SAMPLE_RATE))
  const [capture] = useState<PcmCapture>(() =>
    createPcmCapture(CAPTURE_SAMPLE_RATE, CAPTURE_BUFFER_SIZE)
  )

  // `true` is unconditional; the `false` edge is mounted-guarded, as before.
  const onSpeakingChange = useCallback((speaking: boolean) => {
    if (speaking) setIsAiSpeaking(true)
    else if (mountedRef.current) setIsAiSpeaking(false)
  }, [])

  const onPlaybackDrained = useCallback(() => {
    // If the closing recap's terminal `done` chunk already arrived and this was
    // the last audio frame, resolve the pending requestClosing promise so GamePage
    // can navigate to the results screen.
    if (closingDoneRef.current) {
      const resolve = closingResolveRef.current
      if (resolve) {
        closingResolveRef.current = null
        closingInProgressRef.current = false
        closingDoneRef.current = false
        resolve()
      }
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
      playback.isPlaying() ||
      awaitingResponseRef.current ||
      (turnStreamingRef.current && !suppressTurnRef.current)
    if (aiHoldsFloor) return
    setAwaiting(true)
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'turn' }))
        playerTurnsRef.current += 1
        if (guards && playerTurnsRef.current >= guards.maxPlayerTurns) {
          turnLimitPendingRef.current = true
        }
      } catch {
        /* non-fatal — a dropped turn just means this utterance isn't answered */
      }
    }
  }, [setAwaiting, playback, guards])

  /** A VAD `speech-start`: the player began an utterance (incl. barge-in). */
  const onSpeechStart = useCallback(() => {
    // Barge-in: the player is talking while the AI's audio is playing. Stop the
    // playback at once and drop the rest of the interrupted turn's streamed
    // chunks (text + audio) — the server keeps streaming them (it cancels nothing
    // in v1), so the client must locally discard them until that turn's `done`.
    const bargeIn = playback.isPlaying()
    if (bargeIn) {
      playback.interrupt(onSpeakingChange)
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
    clearSilenceGuard()
    finalDeliveredRef.current = false
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
        const latest = getGameStateRef.current?.() ?? gameStateRef.current
        updateGameState(latest)
        ws.send(JSON.stringify({ type: 'speech-start' }))
      } catch {
        /* non-fatal — a dropped speech-start just defers live transcription to the turn */
      }
    }
  }, [playback, safeDispatch, onSpeakingChange, clearSilenceGuard, updateGameState])

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

  const closeSession = useCallback(() => {
    captureEpochRef.current += 1
    clearGuardTimers()
    clearEndAckTimeout()
    if (awaitingTimeoutRef.current) {
      clearTimeout(awaitingTimeoutRef.current)
      awaitingTimeoutRef.current = null
    }
    const pending = pendingStreamRef.current
    pendingStreamRef.current = null
    pending?.getTracks().forEach((track) => track.stop())
    capture.stop()
    playback.teardown(onSpeakingChange)
    closeSocket(true)
    openedRef.current = false
    endedRef.current = false
    awaitingResponseRef.current = false
    if (mountedRef.current) {
      setAwaitingResponse(false)
      setPlayerSpeaking(false)
    }
    safeDispatch({ type: 'closed' })
  }, [
    capture,
    clearEndAckTimeout,
    clearGuardTimers,
    closeSocket,
    onSpeakingChange,
    playback,
    safeDispatch,
  ])

  useEffect(() => {
    guardCloseRef.current = (code) => {
      if (mountedRef.current) setErrorCode(code)
      closeSession()
    }
  }, [closeSession])

  const connect = useCallback(() => {
    // Double-connect guard: only one socket per mounted lifecycle.
    if (wsRef.current || openedRef.current) {
      const pending = pendingStreamRef.current
      pendingStreamRef.current = null
      pending?.getTracks().forEach((track) => track.stop())
      return
    }
    const data = manualDataRef.current
    if (!data) return
    const captureEpoch = ++captureEpochRef.current
    openedRef.current = true
    endedRef.current = false
    setErrorCode(null)
    playerTurnsRef.current = 0
    turnLimitPendingRef.current = false
    sentSectionsRef.current = null
    safeDispatch({ type: 'connecting' })

    let ws: WebSocket
    try {
      ws = new WebSocket(buildSessionUrl(window.location, randomSessionName(sessionNamePrefix)))
    } catch {
      setErrorCode('transport')
      safeDispatch({ type: 'transport-error', message: 'failed to open voice connection' })
      closeSession()
      return
    }
    wsRef.current = ws

    if (guards) {
      connectTimeoutRef.current = setTimeout(
        () => guardCloseRef.current('connect-timeout'),
        guards.connectMs
      )
      durationTimeoutRef.current = setTimeout(
        () => guardCloseRef.current('duration-limit'),
        guards.maxDurationMs
      )
    }

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
        opening,
        ...(streakDaysRef.current !== undefined && streakDaysRef.current > 0
          ? { streakDays: streakDaysRef.current }
          : {}),
      }
      try {
        ws.send(JSON.stringify(create))
        // The first module's sections rode this `create`; record them so a later
        // module advance sends ONE `update-gamestate` (and the module the session
        // was created with never triggers a redundant steer).
        sentSectionsRef.current = gameStateSignature(gameStateRef.current)
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
      if (frame.type === 'action') {
        // The SOLE handling path for co_build `action` frames: hand the partner's
        // structured moves to the game's callback and STOP — the frame never
        // reaches `safeDispatch`/`voiceReducer`, so the exposed session state is
        // untouched. Absent callback (every non-co_build game) ⇒ a pure no-op.
        //
        // Barge-in transactional semantics: a turn's actions share the fate of its
        // speech. When the player barged in on this turn (`suppressTurnRef`), the
        // reply was abandoned — its trailing chunks (text + audio) are already being
        // dropped until its `done`, so its action frame is dropped in lockstep. The
        // move belonged to a turn the player interrupted; delivering it would mutate
        // the board for a reply the player chose to override.
        if (suppressTurnRef.current) return
        onActionRef.current?.(frame.actions)
        return
      }
      if (frame.type === 'created') {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        // The AI greets first: open the mic now and mark the opening greeting
        // pending (-> "thinking" until its audio plays).
        setAwaiting(opening)
        const preGranted = pendingStreamRef.current
        pendingStreamRef.current = null
        capture.start({
          preGranted: preGranted ?? undefined,
          onSpeechStart,
          onUtteranceEnd,
          onError: (message: string) => {
            safeDispatch({ type: 'mic-error', message })
            if (guards) guardCloseRef.current('microphone')
            else setErrorCode('microphone')
          },
          isMounted: () => mountedRef.current && captureEpochRef.current === captureEpoch,
          getSocket: () => (captureEpochRef.current === captureEpoch ? wsRef.current : null),
        })
        safeDispatch({ type: 'frame', frame })
        if (!opening) armSilenceGuard()
        return
      }
      if (frame.type === 'transcript') {
        if (frame.final && !finalDeliveredRef.current) {
          finalDeliveredRef.current = true
          onFinalTranscriptRef.current?.({
            sequence: ++utteranceSequenceRef.current,
            text: frame.text,
          })
        }
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
          playback.play(base64ToBytes(frame.audio), onSpeakingChange, onPlaybackDrained)
        }
        safeDispatch({ type: 'frame', frame })
        if (frame.done) {
          if (turnLimitPendingRef.current) guardCloseRef.current('turn-limit')
          else armSilenceGuard()
        }
        // Closing-recap resolution: when the recap's terminal `done` chunk
        // arrives, flip `closingDoneRef`. If no audio frames are queued (a
        // text-only or zero-TTS edge case), resolve the promise immediately;
        // otherwise `source.onended` resolves it once the last frame drains.
        if (frame.done && closingInProgressRef.current) {
          closingDoneRef.current = true
          if (!playback.isPlaying()) {
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
      if (frame.type === 'summary') {
        captureEpochRef.current += 1
        clearEndAckTimeout()
        safeDispatch({ type: 'frame', frame })
        capture.stop()
        playback.teardown(onSpeakingChange)
        closeSocket(true)
        openedRef.current = false
        return
      }
      if (frame.type === 'error') {
        // A benign in-band rejection leaves the socket open and must NOT read as
        // an error. The common one is `turn_in_flight` (our VAD raced the server's
        // own in-flight turn): release any pending "thinking" wait so the UI falls
        // back to listening. The reducer drops the benign codes, so no error line
        // shows; an unexpected code still surfaces through the reducer.
        if (frame.code === 'turn_in_flight' && awaitingResponseRef.current) setAwaiting(false)
        if (frame.code !== 'turn_in_flight' && frame.code !== 'already_created') {
          setErrorCode('server')
        }
        safeDispatch({ type: 'frame', frame })
        return
      }
      safeDispatch({ type: 'frame', frame })
    }

    ws.onerror = () => {
      setErrorCode('transport')
      safeDispatch({ type: 'transport-error', message: 'voice connection error' })
    }

    ws.onclose = (event) => {
      captureEpochRef.current += 1
      wsRef.current = null
      openedRef.current = false
      clearGuardTimers()
      clearEndAckTimeout()
      capture.stop()
      playback.teardown(onSpeakingChange)
      const pending = pendingStreamRef.current
      pendingStreamRef.current = null
      pending?.getTracks().forEach((track) => track.stop())
      if (endedRef.current || event.code === 1000) {
        safeDispatch({ type: 'closed' })
      } else {
        setErrorCode('transport')
        // The server attaches a bounded `safeCloseReason` to every 1008 — surface
        // it so a residual failure is self-explaining, not a bare numeric code.
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
    onPlaybackDrained,
    armSilenceGuard,
    clearEndAckTimeout,
    clearGuardTimers,
    closeSession,
    closeSocket,
    guards,
    opening,
    safeDispatch,
    sessionNamePrefix,
    setAwaiting,
  ])

  // --- Public actions ---

  const openSession = useCallback(
    (stream?: MediaStream) => {
      if (manualDataRef.current === null) {
        stream?.getTracks().forEach((track) => track.stop())
        return
      }
      if (wsRef.current || openedRef.current) {
        stream?.getTracks().forEach((track) => track.stop())
        return
      }
      pendingStreamRef.current = stream ?? null
      connect()
    },
    [connect]
  )

  const endSession = useCallback(() => {
    // Exactly-once: the settlement seam (GamePage's RESULT effect) and any
    // teardown path can both reach here, and a duplicate `{type:'end'}` would
    // double the server's memory-capture hand-off. `endedRef` — the same flag
    // the clean-close `onclose` reads — is set the instant `end` is sent, so a
    // second call is a no-op.
    if (endedRef.current) return
    clearGuardTimers()
    clearEndAckTimeout()
    if (awaitingTimeoutRef.current) {
      clearTimeout(awaitingTimeoutRef.current)
      awaitingTimeoutRef.current = null
    }
    captureEpochRef.current += 1
    capture.stop()
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Mark ended so a duplicate terminal effect is a no-op. Keep the socket
      // open only for the bounded summary-ack window; summary or timeout owns
      // deterministic teardown.
      endedRef.current = true
      try {
        ws.send(JSON.stringify({ type: 'end' }))
        endAckTimeoutRef.current = setTimeout(() => {
          endAckTimeoutRef.current = null
          closeSession()
        }, GAME_VOICE_END_ACK_TIMEOUT_MS)
      } catch {
        closeSession()
      }
    } else {
      closeSession()
    }
  }, [capture, clearEndAckTimeout, clearGuardTimers, closeSession])

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
  const requestClosing = useCallback((outcome?: GameVoiceRecapOutcome): Promise<void> => {
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
    // This effect synchronizes React with the external WebSocket session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoConnect) connect()
    return () => {
      mountedRef.current = false
      captureEpochRef.current += 1
      if (awaitingTimeoutRef.current) {
        clearTimeout(awaitingTimeoutRef.current)
        awaitingTimeoutRef.current = null
      }
      clearGuardTimers()
      clearEndAckTimeout()
      const pending = pendingStreamRef.current
      pendingStreamRef.current = null
      pending?.getTracks().forEach((track) => track.stop())
      capture.stop()
      playback.teardown(onSpeakingChange)
      closeSocket(true)
      openedRef.current = false
    }
  }, [
    autoConnect,
    hasManual,
    connect,
    capture,
    playback,
    onSpeakingChange,
    closeSocket,
    clearEndAckTimeout,
    clearGuardTimers,
  ])

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
  const liveSectionsSignature = gameStateSignature(gameState)
  useEffect(() => {
    if (state.status !== 'ready') return
    if (sentSectionsRef.current === liveSectionsSignature) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    updateGameState(gameStateRef.current)
  }, [liveSectionsSignature, state.status, updateGameState])

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
    errorCode,
    // The shared reducer stores the summary as an opaque payload (keeping
    // `shared/` free of a workspace dependency); re-narrow to the concrete wire
    // `SessionSummary` here, at this package's boundary. The client only forwards
    // the value, so this assertion is the single place the type is recovered.
    summary: state.summary,
    openSession,
    closeSession,
    updateGameState,
    sendText,
    endSession,
    requestClosing,
  }
}
