/**
 * `createPcmPlayback` — the game-agnostic TTS playback shell for a voice session.
 *
 * Both voice hooks (the in-game `useVoiceSession` and the lobby
 * `useLobbyVoiceSession`) stream base64 PCM16 audio frames from the server and
 * schedule them GAPLESSLY through one shared `AudioContext`: each frame is
 * decoded (`pcm16ToFloat32`), wrapped in an `AudioBuffer` at the wire sample
 * rate, and started at the running cursor so consecutive frames butt up against
 * each other with no gap. The context runs at its native rate and resamples the
 * fixed-rate buffers.
 *
 * The controller owns exactly the imperative Web Audio state that used to be
 * duplicated in each hook (the playback context, the schedule cursor, the live
 * scheduled sources, and the playing count that drives the "AI is speaking"
 * signal). It is a PURE state machine with no React coupling: the lifecycle
 * callbacks are supplied at CALL time (all in event-handler contexts), never at
 * construction, so a hook never reads a ref during render.
 *  - `onSpeakingChange(true)` fires the instant a frame is scheduled and
 *    `onSpeakingChange(false)` when the last scheduled frame drains or playback
 *    is interrupted — the caller applies its own mounted-guard on the `false`
 *    edge, exactly as before.
 *  - `onDrained` (optional, `play` only) fires after a frame ends and the queue
 *    is fully drained; the in-game hook uses it to resolve the closing-recap
 *    promise once the recap audio has finished, the lobby hook omits it.
 */
import { pcm16ToFloat32 } from './audio-pcm'
import { closeAudioContext } from './audio-context'

/**
 * Called when playback transitions between speaking / silent: `true` the moment a
 * frame is scheduled, `false` when the last scheduled frame drains or playback is
 * interrupted. Mirrors the previous inline `setIsAiSpeaking` calls; the caller
 * applies its own mounted-guard on the `false` edge.
 */
export type OnSpeakingChange = (speaking: boolean) => void

export interface PcmPlayback {
  /**
   * Schedule one PCM16 frame for gapless playback. `onDrained` fires once the
   * queue fully drains after this (or a later) frame ends.
   */
  play(bytes: Uint8Array, onSpeakingChange: OnSpeakingChange, onDrained?: () => void): void
  /** Stop all scheduled playback immediately but KEEP the context alive. */
  interrupt(onSpeakingChange: OnSpeakingChange): void
  /** Stop playback AND release the context — full teardown (unmount / end). */
  teardown(onSpeakingChange: OnSpeakingChange): void
  /** True while any scheduled buffer has not yet ended. */
  isPlaying(): boolean
}

export function createPcmPlayback(outputSampleRate: number): PcmPlayback {
  let ctx: AudioContext | null = null
  /** Next scheduled playback start time, for gapless PCM frame queueing. */
  let cursor = 0
  /** Count of scheduled-but-not-ended buffers, driving the speaking signal. */
  let playingCount = 0
  /** Live scheduled sources, so barge-in can stop them without closing the context. */
  const activeSources = new Set<AudioBufferSourceNode>()

  function ensureCtx(): AudioContext | null {
    if (ctx) return ctx
    try {
      const created = new AudioContext()
      void created.resume?.()
      ctx = created
      cursor = created.currentTime
      return created
    } catch {
      return null
    }
  }

  function play(
    bytes: Uint8Array,
    onSpeakingChange: OnSpeakingChange,
    onDrained?: () => void
  ): void {
    const floats = pcm16ToFloat32(bytes)
    if (floats.length === 0) return
    const audioCtx = ensureCtx()
    if (!audioCtx) return
    try {
      const buffer = audioCtx.createBuffer(1, floats.length, outputSampleRate)
      buffer.getChannelData(0).set(floats)
      const source = audioCtx.createBufferSource()
      source.buffer = buffer
      source.connect(audioCtx.destination)
      const startAt = Math.max(audioCtx.currentTime, cursor)
      source.start(startAt)
      cursor = startAt + buffer.duration
      playingCount += 1
      activeSources.add(source)
      onSpeakingChange(true)
      source.onended = () => {
        activeSources.delete(source)
        playingCount = Math.max(0, playingCount - 1)
        if (playingCount === 0) {
          onSpeakingChange(false)
          onDrained?.()
        }
      }
    } catch {
      // A playback failure must never break the turn — text still renders.
    }
  }

  function interrupt(onSpeakingChange: OnSpeakingChange): void {
    for (const source of activeSources) {
      try {
        source.onended = null
        source.stop?.()
        source.disconnect?.()
      } catch {
        /* ignore — source may already have ended */
      }
    }
    activeSources.clear()
    playingCount = 0
    cursor = ctx?.currentTime ?? 0
    onSpeakingChange(false)
  }

  function teardown(onSpeakingChange: OnSpeakingChange): void {
    interrupt(onSpeakingChange)
    const closing = ctx
    ctx = null
    cursor = 0
    closeAudioContext(closing)
  }

  function isPlaying(): boolean {
    return playingCount > 0
  }

  return { play, interrupt, teardown, isPlaying }
}
