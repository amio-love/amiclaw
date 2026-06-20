/**
 * Connect / first-response timeout primitives for the provider adapters.
 *
 * Every provider layer waits on a network event that, in a healthy run, arrives
 * within a couple of seconds but in a degraded run may NEVER arrive: a `fetch`
 * that hangs before returning the response headers, a WebSocket upgrade that
 * never completes, a TTS handshake gate the server never acknowledges, an ASR
 * queue that never produces a first transcript. With no deadline on these the
 * turn's provider `await` parks forever — and because `AsyncIterator.return()`
 * cannot interrupt a pending provider `await` (see `session-do.ts`'s cancel
 * note), the turn generator never reaches its `finally`, so `turnInFlight` is
 * never released and the whole session locks up until the Cloudflare platform
 * hard timeout. These helpers bound exactly the connect + first-response window
 * so a hung provider degrades into the adapter's already-correct fail-loud path
 * (provider throws -> `Promise.race` rejects -> DO closes the WS 1008) instead
 * of hanging.
 *
 * Scope discipline (the load-bearing invariant): these bound the CONNECT and
 * FIRST-RESPONSE phases ONLY, never a whole turn. A legitimate long streaming
 * response — first byte/event arrived in time, then the model streams for a
 * while — must never be killed by a timer. So every call site cancels its timer
 * the instant the first response lands, and the streaming that follows runs with
 * no timeout at all.
 *
 * The millisecond values in `TIMEOUTS` are conservative defaults chosen for
 * voice-turn reasonableness; they are L3-tunable — the L2 acceptance target says
 * the exact values are set against real measured provider latency at deploy
 * time. They are named constants (not magic numbers) precisely so that tuning is
 * a one-line edit here.
 */

/**
 * Connect / first-response deadlines, in milliseconds. Conservative voice-turn
 * defaults; L3-tunable against measured provider latency (see file header).
 */
export const TIMEOUTS = {
  /**
   * Establishing the network connection: the `fetch` POST to DeepSeek and the
   * WebSocket upgrade `fetch` to Volcengine. ~10s is generous for a TLS + TCP
   * handshake to a healthy endpoint while still failing a dead connection fast
   * enough to surface a turn error rather than parking the session.
   */
  connectMs: 10_000,
  /**
   * First response after the connection is up: the first SSE byte from DeepSeek,
   * the TTS `ConnectionStarted` / `SessionStarted` handshake acknowledgements,
   * the first ASR transcript. ~20s tolerates a slow first model token / server
   * handshake (voice models can take several seconds to first output) while
   * still bounding a server that accepts the connection then goes silent. Only
   * the FIRST response is bounded; subsequent streaming is unbounded.
   */
  firstResponseMs: 20_000,
} as const

/**
 * A timer that runs `onTimeout` once after `ms`, unless `cancel()` is called
 * first. Idempotent: `cancel()` after the timer has already fired (or after a
 * prior `cancel()`) is a no-op. This is the single-shot deadline behind every
 * call site below — start it before the awaited event, cancel it the instant the
 * event lands.
 */
export interface Deadline {
  /** Stop the timer if it has not fired yet. Idempotent. */
  cancel(): void
}

/**
 * Arm a single-shot deadline. `onTimeout` fires at most once, only if `cancel()`
 * has not run first. The handle is `unref`'d when the runtime supports it so a
 * pending deadline never keeps a Worker / Node process alive on its own.
 */
export function startDeadline(ms: number, onTimeout: () => void): Deadline {
  let fired = false
  const handle = setTimeout(() => {
    fired = true
    // `onTimeout` performs real fail-loud work at the call sites (abort a
    // handshake, fail a queue, close a socket) — any of which may throw. A throw
    // here would escape as an uncaught exception on the timer macrotask (no
    // `await` is in scope to catch it), so swallow it: the timer's only job is
    // to mark the deadline fired and kick the call site's cleanup. Re-throwing
    // buys nothing and destabilises the runtime.
    try {
      onTimeout()
    } catch {
      // Intentionally inert: a failing cleanup must not crash the timer.
    }
  }, ms)
  // In Node a bare timer keeps the event loop alive; `unref` (absent in the
  // Workers runtime) detaches it so it never blocks shutdown on its own.
  ;(handle as unknown as { unref?: () => void }).unref?.()
  return {
    cancel(): void {
      if (fired) return
      clearTimeout(handle)
    },
  }
}

/**
 * Race a single awaited event against a first-response deadline.
 *
 * Resolves/rejects with `promise` if it settles within `ms`. If the deadline
 * fires first, `onTimeout()` is invoked (the call site uses it to push the
 * underlying source into its existing fail-loud path — abort a handshake, fail a
 * queue, close a socket) and the returned promise rejects with `Error(message)`.
 * The reject is deterministic: even if `onTimeout()` throws, the timeout branch
 * still rejects with `Error(message)` (the cleanup failure is attached as
 * `cause`), so `Promise.race` always settles and the hang this module prevents
 * cannot reappear. The deadline is always cancelled once `promise` settles, so a
 * slow-but-valid first response leaves no live timer and the streaming that
 * follows is unbounded.
 *
 * This bounds ONLY the first event it is given — never a whole stream. Call it
 * on the gate/first-chunk await, not around the consuming loop.
 */
export async function awaitWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout: () => void
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    const deadline = startDeadline(ms, () => {
      // The reject must be deterministic: if `onTimeout()` throws, the timeout
      // branch must STILL reject so `Promise.race` settles. A throw that skipped
      // the reject would leave the race forever pending — exactly the hang this
      // module exists to prevent. So run the call site's cleanup defensively and,
      // when it throws, attach the failure as the reject's `cause` for diagnosis
      // rather than letting it derail the reject.
      let onTimeoutError: unknown
      try {
        onTimeout()
      } catch (err) {
        onTimeoutError = err
      }
      reject(
        onTimeoutError === undefined
          ? new Error(message)
          : new Error(message, { cause: onTimeoutError })
      )
    })
    // When the real promise settles first, stop the timer so it neither fires
    // late nor leaves a dangling handle. Attached inertly: this `.then` only
    // cancels the deadline; the awaited value/rejection flows through `race`.
    void promise.then(
      () => deadline.cancel(),
      () => deadline.cancel()
    )
  })
  return Promise.race([promise, timeout])
}
