/**
 * Lazy, shared AudioContext with iOS unlock and a decoded-buffer cache.
 *
 * Why lazy: browsers (Safari especially) refuse to create / resume an
 * AudioContext outside a user gesture. We create it on the first call to
 * `getAudioContext()` — which itself is only invoked from inside a click /
 * pointer handler — and resume it once.
 *
 * Why a buffer cache: each AudioBufferSourceNode is single-use, but the
 * decoded AudioBuffer is reusable. We decode each of the 3 samples once,
 * lazily on first use, and hand out fresh source nodes per play.
 */

export type SampleName = 'click' | 'tick' | 'thunk'

const SAMPLE_URLS: Record<SampleName, string> = {
  click: '/audio/click.ogg',
  tick: '/audio/tick.ogg',
  thunk: '/audio/thunk.ogg',
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
