/**
 * `createPcmCapture` — the game-agnostic mic-capture + VAD shell for a voice
 * session.
 *
 * Both voice hooks open the mic ONCE per session and stream continuous PCM16
 * 16 kHz frames: a `ScriptProcessorNode` analyses each frame with the shared VAD
 * (driving utterance-start / utterance-end callbacks), then resamples the frame
 * to the fixed wire rate and sends it as a binary WebSocket frame. `getUserMedia`
 * requests echo cancellation + noise suppression so the open mic does not pick up
 * the AI's own voice.
 *
 * The controller owns exactly the imperative capture state that used to be
 * duplicated in each hook (the media stream, the capture context + nodes, the
 * capturing guard, and the running VAD state). It is a PURE state machine with no
 * React coupling: the turn-floor arbitration (which READS the VAD events and
 * decides whether to hand the floor to the server) and the socket lifecycle stay
 * in each hook, and every callback is supplied to `start` at CALL time (an
 * event-handler context), never at construction, so a hook never reads a ref
 * during render:
 *  - `onSpeechStart` / `onUtteranceEnd` — the VAD events, handled by the hook.
 *  - `onError` — the hook's bounded mic-error surface.
 *  - `isMounted` / `getSocket` — checked after the async mic acquire and per
 *    frame, so a panel unmount / socket close mid-acquire aborts cleanly and PCM
 *    is only sent over an OPEN socket.
 *
 * `start`'s optional `preGranted` REUSES an already-granted `MediaStream` (the
 * lobby's permission probe) so the browser is not prompted a second time; with no
 * stream it acquires its own (the in-game path).
 */
import { floatTo16BitPCM, resamplePcmFloat32 } from './audio-pcm'
import {
  computeRms,
  DEFAULT_VAD_CONFIG,
  initialVadState,
  vadStep,
  type VadState,
} from './voice-vad'
import { closeAudioContext } from './audio-context'

export interface PcmCaptureStartOptions {
  /**
   * Optionally REUSE an already-granted `MediaStream` (the lobby's permission
   * probe) so the browser is not prompted a second time.
   */
  preGranted?: MediaStream
  /** VAD `speech-start`: the player began an utterance (incl. barge-in). */
  onSpeechStart: () => void
  /** VAD `utterance-end`: the player went silent after speaking. */
  onUtteranceEnd: () => void
  /** Bounded mic error surface (permission denied / capture failed). */
  onError: (message: string) => void
  /** Whether the owner is still mounted — checked after the async mic acquire. */
  isMounted: () => boolean
  /**
   * The live socket to stream PCM over. Read after acquire (capture aborts if it
   * is gone) and per frame (PCM is sent only over an OPEN socket).
   */
  getSocket: () => WebSocket | null
}

export interface PcmCapture {
  /**
   * Acquire the mic (or reuse `preGranted`), wire the VAD + PCM streaming, and
   * begin. A no-op while already capturing.
   */
  start(startOptions: PcmCaptureStartOptions): void
  /** Stop capture, tear down the nodes + context, and release the mic. */
  stop(): void
}

export function createPcmCapture(captureSampleRate: number, bufferSize: number): PcmCapture {
  let mediaStream: MediaStream | null = null
  let captureCtx: AudioContext | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let proc: ScriptProcessorNode | null = null
  /**
   * Identity of the pending-or-live capture attempt. A stopped attempt may still
   * resolve or reject asynchronously; only the current identity may mutate shared
   * controller state or report an error into the owning session.
   */
  let attemptSequence = 0
  let activeAttempt: number | null = null
  /** Running VAD state, folded one capture frame at a time. */
  let vadState: VadState = initialVadState
  /** Analyzed-frame wall-clock duration (`bufferSize / actualRate`), ms. */
  let frameMs = (bufferSize / captureSampleRate) * 1000

  function stop(): void {
    activeAttempt = null
    vadState = initialVadState
    if (proc) {
      proc.onaudioprocess = null
      try {
        proc.disconnect()
      } catch {
        /* ignore */
      }
      proc = null
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect()
      } catch {
        /* ignore */
      }
      sourceNode = null
    }
    const ctx = captureCtx
    captureCtx = null
    closeAudioContext(ctx)
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop())
      mediaStream = null
    }
  }

  function start(startOptions: PcmCaptureStartOptions): void {
    if (activeAttempt !== null) return
    const attempt = ++attemptSequence
    activeAttempt = attempt
    const { preGranted, onSpeechStart, onUtteranceEnd, onError, isMounted, getSocket } =
      startOptions
    void (async () => {
      let stream: MediaStream
      if (preGranted) {
        stream = preGranted
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          })
        } catch {
          if (activeAttempt !== attempt) return
          activeAttempt = null
          onError('microphone permission denied')
          return
        }
      }
      // `stop()` followed by a new `start()` can happen while permission is in
      // flight. A stale success owns only its returned stream; it must not clear
      // or otherwise mutate the newer attempt.
      if (activeAttempt !== attempt) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      // The panel may have unmounted / the socket closed during the async acquire.
      if (!isMounted() || !getSocket()) {
        stream.getTracks().forEach((t) => t.stop())
        if (activeAttempt === attempt) activeAttempt = null
        return
      }
      mediaStream = stream
      try {
        const ctx = new AudioContext({ sampleRate: captureSampleRate })
        captureCtx = ctx
        // Browsers may ignore the requested rate and run the context at the
        // hardware rate (e.g. 48000). The wire format is fixed — resample each
        // frame to the true target rate before encoding.
        const actualRate = ctx.sampleRate
        frameMs = (bufferSize / actualRate) * 1000
        vadState = initialVadState
        const src = ctx.createMediaStreamSource(stream)
        sourceNode = src
        const processor = ctx.createScriptProcessor(bufferSize, 1, 1)
        proc = processor
        processor.onaudioprocess = (e) => {
          const frame = e.inputBuffer.getChannelData(0)
          // 1) VAD on the raw frame (energy is rate-independent), driving the
          //    conversation phase + barge-in.
          const rms = computeRms(frame)
          const stepped = vadStep(vadState, rms, frameMs, DEFAULT_VAD_CONFIG)
          vadState = stepped.state
          if (stepped.event === 'speech-start') onSpeechStart()
          else if (stepped.event === 'utterance-end') onUtteranceEnd()
          // 2) Stream the frame continuously as PCM16 at the wire rate.
          const socket = getSocket()
          if (!socket || socket.readyState !== WebSocket.OPEN) return
          const pcm =
            actualRate === captureSampleRate
              ? frame
              : resamplePcmFloat32(frame, actualRate, captureSampleRate)
          socket.send(floatTo16BitPCM(pcm))
        }
        src.connect(processor)
        processor.connect(ctx.destination)
      } catch {
        // Setup is synchronous, but retain the identity fence so a future async
        // implementation cannot let an old failure tear down the current capture.
        if (activeAttempt === attempt) {
          stop()
          onError('microphone capture failed')
        } else {
          stream.getTracks().forEach((t) => t.stop())
        }
      }
    })()
  }

  return { start, stop }
}
