/**
 * Lazy, shared AudioContext with iOS unlock and a decoded-buffer cache.
 *
 * Why lazy: browsers (Safari especially) refuse to create / resume an
 * AudioContext outside a user gesture. The PRIMARY unlock therefore happens
 * inside a real user gesture — the ConnectPage 进入游戏 tap calls
 * `getAudioContext()` before navigating to the run, creating + resuming the
 * context while a gesture is in scope. Because the call is idempotent (it
 * returns the existing context and only re-resumes if suspended), later
 * fallback calls are safe even when they run OUTSIDE a gesture — e.g. the
 * GamePage START_GAME effect calls it again at game start as a belt-and-braces
 * fallback. On a browser that already unlocked during the gesture that
 * fallback is a no-op; on one that did not, the resume is retried.
 *
 * Why a buffer cache: each AudioBufferSourceNode is single-use, but the
 * decoded AudioBuffer is reusable. We decode each of the 4 samples once,
 * lazily on first use, and hand out fresh source nodes per play.
 */

export type SampleName = 'click' | 'tick' | 'thunk' | 'explosion'

const SAMPLE_URLS: Record<SampleName, string> = {
  click: '/audio/click.ogg',
  tick: '/audio/tick.ogg',
  thunk: '/audio/thunk.ogg',
  explosion: '/audio/explosion.ogg',
}

let ctx: AudioContext | null = null
const bufferCache = new Map<SampleName, AudioBuffer>()
const inflight = new Map<SampleName, Promise<AudioBuffer | null>>()

/**
 * Returns the shared AudioContext, creating it on first call. Resumes it
 * if it's been suspended (iOS / autoplay policy). Returns null when the
 * browser has no Web Audio support — callers must treat audio as optional.
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    return ctx
  }
  // Safari < 14 still ships only the webkit prefix.
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
  return ctx
}

/**
 * Returns a decoded AudioBuffer for the given sample, fetching and decoding
 * on first request. Concurrent requests share a single in-flight Promise.
 * Resolves to null if fetch / decode fails — silent-fail by design.
 */
export function getBuffer(name: SampleName): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(name)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(name)
  if (pending) return pending

  const promise = (async () => {
    const context = getAudioContext()
    if (!context) return null
    try {
      const res = await fetch(SAMPLE_URLS[name])
      if (!res.ok) return null
      const arrayBuf = await res.arrayBuffer()
      const buf = await context.decodeAudioData(arrayBuf)
      bufferCache.set(name, buf)
      return buf
    } catch {
      return null
    } finally {
      inflight.delete(name)
    }
  })()

  inflight.set(name, promise)
  return promise
}

let masterGain: GainNode | null = null
let masterMuted = false

/**
 * Returns the shared master GainNode — the single node every SFX is routed
 * through before reaching `ctx.destination`. Created lazily on first call and
 * connected straight to the destination. Its gain encodes the mute state
 * (0 when muted, 1 otherwise), so routing every sound through it means mute
 * is enforced in exactly one place. Returns null when Web Audio is
 * unavailable — callers fall back to connecting directly to the destination.
 */
export function getMasterGain(): GainNode | null {
  const context = getAudioContext()
  if (!context) return null
  if (masterGain) return masterGain
  try {
    const gain = context.createGain()
    gain.gain.value = masterMuted ? 0 : 1
    gain.connect(context.destination)
    masterGain = gain
  } catch {
    // createGain / connect can throw if the context was closed; silent-fail.
    masterGain = null
    return null
  }
  return masterGain
}

/**
 * Sets whether the master GainNode silences all output. Updates the live node
 * immediately when it exists, and records the value so a master gain created
 * later (lazily, on first SFX) starts in the correct state. The mute feature's
 * persistence + React layer (`mute.ts`) is the sole caller.
 */
export function setMasterMuted(muted: boolean): void {
  masterMuted = muted
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : 1
  }
}
