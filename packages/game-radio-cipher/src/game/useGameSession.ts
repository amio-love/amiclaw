/**
 * The playable listener's game state, layered over the REAL engine.
 *
 * Engine-owned (genuine integration):
 *  - per-role leak-guarded views (getRoleView('listener'))
 *  - the decryption_progress state machine (encrypted -> partial -> decrypted)
 *  - win detection (isWon(), the fixture's all_solved condition)
 *
 * Playable-owned (things the engine cannot express — see engine-findings):
 *  - semantic answer verification (the plaintext_is_valid_word predicate never
 *    auto-fires by design; the human layer confirms). We compare the typed 汉字
 *    against the content's real plaintext, and ONLY on a match do we drive the
 *    engine's execute_decryption to advance the segment to decrypted.
 *  - the count-up stopwatch and the +30s wrong-answer penalty (no engine notion
 *    of time or failure).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { GameSession } from '@amiclaw/creation'
import type { PlayableLevel } from '../content/levels'
import type { PlayableSegment } from '../content/tutorial-level'

const PENALTY_SECONDS = 30
/** Bound on execute_decryption calls per correct answer (fixture max_steps is 5). */
const DECRYPT_GUARD = 8

export interface SegmentProgress {
  id: string
  /** Listener-visible content_length enum value (short / medium / long). */
  contentLength: string
  /** Listener-visible decryption_progress state (encrypted / partial / decrypted). */
  progress: string
  decrypted: boolean
}

/**
 * Answer-submission outcome. `wrong` is a genuine wrong guess (already charged
 * the +30s penalty); `empty` is a defensive no-op (empty/whitespace, never a
 * penalty); `error` means the answer matched but the engine failed to reach
 * `decrypted` within the guard — surfaced distinctly so the UI does NOT treat
 * it as a wrong answer.
 */
export type SubmitResult = { ok: true } | { ok: false; reason: 'empty' | 'wrong' | 'error' }

export interface GameSessionApi {
  segments: SegmentProgress[]
  submitAnswer: (segmentId: string, guess: string) => SubmitResult
  elapsedSeconds: number
  penaltySeconds: number
  totalSeconds: number
  won: boolean
  /** Increments on every wrong answer — a change cue for UI feedback. */
  wrongToken: number
  /** Increments on every reset — remounts segment cards to clear typed input. */
  resetToken: number
  /**
   * Starts the stopwatch (idempotent). The clock does NOT run at mount — the UI
   * calls this on the player's first meaningful moment (onboarding dismissal /
   * first interaction), so first-run reading time is never scored.
   */
  start: () => void
  reset: () => void
}

/**
 * The engine plus its render-time projection, held together in one state value.
 * The engine instance lives in state (not a ref) so render can read `segments` /
 * `won` without ever touching a ref, while handlers reach the same instance via
 * the state closure. Every mutation produces a fresh wrapper object so React
 * re-renders; the `session` inside is mutated in place by the engine.
 */
interface EngineState {
  session: GameSession
  segments: SegmentProgress[]
  won: boolean
}

/** Build a fresh EngineState by projecting the engine's current listener view. */
function projectEngine(session: GameSession): EngineState {
  const listenerView = session.getRoleView('listener')
  const segments: SegmentProgress[] = listenerView.elements.map((element) => {
    const progress = String(element.visible_states.decryption_progress ?? '')
    return {
      id: element.element_id,
      contentLength: String(element.visible_params.content_length ?? ''),
      progress,
      decrypted: progress === 'decrypted',
    }
  })
  return { session, segments, won: session.isWon() }
}

export function useGameSession(playableLevel: PlayableLevel): GameSessionApi {
  const { gameType, level } = playableLevel
  const segmentsById: Record<string, PlayableSegment> = Object.fromEntries(
    playableLevel.segments.map((segment) => [segment.id, segment])
  )

  // The engine + its projection live in state (see EngineState). Render reads
  // `engine.segments` / `engine.won`; handlers reach the same instance via
  // `engine.session`. No ref is read during render.
  const [engine, setEngine] = useState<EngineState>(() =>
    projectEngine(new GameSession(gameType, level))
  )

  // startedRef gates the whole clock: it stays false until start() fires, so the
  // interval accrues nothing and elapsed reads 0 while the onboarding overlay is up.
  const startedRef = useRef<boolean>(false)
  const startRef = useRef<number | null>(null)
  // wonRef mirrors engine.won for the interval closure (which is created once
  // and cannot see updated state). Written in handlers, read only in the
  // interval callback — never during render.
  const wonRef = useRef<boolean>(false)
  const [nowMs, setNowMs] = useState(0)
  const [frozenMs, setFrozenMs] = useState(0)
  const [penalty, setPenalty] = useState(0)
  const [wrongToken, setWrongToken] = useState(0)
  const [resetToken, setResetToken] = useState(0)

  // Ref-only (no setState): safe to call from an effect. The interval picks up
  // the new anchor on its next tick; callers that need a 0 display (reset) clear
  // nowMs themselves before calling.
  const start = useCallback((): void => {
    if (startedRef.current) return
    startedRef.current = true
    startRef.current = performance.now()
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      if (!startedRef.current || wonRef.current || startRef.current === null) return
      setNowMs(performance.now() - startRef.current)
    }, 100)
    return () => clearInterval(id)
  }, [])

  const submitAnswer = (segmentId: string, guess: string): SubmitResult => {
    const session = engine.session
    const segment = segmentsById[segmentId]
    if (!segment) return { ok: false, reason: 'error' }
    const normalized = guess.replace(/\s+/g, '').trim()
    if (normalized === '') {
      // Defensive: an empty / whitespace answer is a no-op, not a wrong guess —
      // no penalty. The UI also guards this; the hook must not depend on it.
      return { ok: false, reason: 'empty' }
    }
    if (normalized !== segment.plaintext.word) {
      setPenalty((value) => value + PENALTY_SECONDS)
      setWrongToken((value) => value + 1)
      return { ok: false, reason: 'wrong' }
    }
    // Correct: drive the real engine toward the decrypted terminal state.
    let guard = 0
    while (
      session.getState().elements[segmentId]?.decryption_progress !== 'decrypted' &&
      guard < DECRYPT_GUARD
    ) {
      session.performAction('listener', 'execute_decryption', { element_id: segmentId })
      guard += 1
    }
    // Re-project the (mutated) engine so the UI reflects the new state — even on
    // the error path below, where the segment may have partially advanced.
    setEngine(projectEngine(session))
    if (session.getState().elements[segmentId]?.decryption_progress !== 'decrypted') {
      // Answer was correct but the engine failed to advance to `decrypted`
      // within the guard. Surface a distinct error — do NOT mark solved, and do
      // NOT charge the wrong-answer penalty.
      return { ok: false, reason: 'error' }
    }
    if (session.isWon() && !wonRef.current) {
      wonRef.current = true
      setFrozenMs(performance.now() - (startRef.current ?? performance.now()))
    }
    return { ok: true }
  }

  const reset = (): void => {
    wonRef.current = false
    startedRef.current = false
    startRef.current = null
    setFrozenMs(0)
    setNowMs(0)
    setPenalty(0)
    setWrongToken(0)
    setResetToken((value) => value + 1)
    setEngine(projectEngine(new GameSession(gameType, level)))
    // Replay is itself the interaction — begin the fresh run immediately.
    start()
  }

  // Before start() the interval accrues nothing and no win can freeze, so nowMs
  // and frozenMs are both 0 here — the un-started clock reads 0. The win freeze
  // is driven by engine.won (state), which flips in the same handler that sets
  // frozenMs, so the two land together on the next render.
  const elapsedSeconds = (engine.won ? frozenMs : nowMs) / 1000
  return {
    segments: engine.segments,
    submitAnswer,
    elapsedSeconds,
    penaltySeconds: penalty,
    totalSeconds: elapsedSeconds + penalty,
    won: engine.won,
    wrongToken,
    resetToken,
    start,
    reset,
  }
}
