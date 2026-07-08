/**
 * `closeAudioContext` — release an `AudioContext`'s hardware resources, swallowing
 * the (possible) close() rejection. Browsers cap the number of concurrent
 * `AudioContext`s, so a leaked context across turns / panel remounts eventually
 * starves the next `new AudioContext(...)` — which is the failure this guards
 * against. Shared by the game-agnostic voice capture + playback controllers.
 */
export function closeAudioContext(ctx: AudioContext | null): void {
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
