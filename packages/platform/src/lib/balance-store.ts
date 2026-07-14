/**
 * Shared starburst-balance store — the single last-known-balance source the
 * TopNav `BalanceChip` subscribes to (reward-economy §7). A module-level
 * singleton, mirroring `useAuth`'s `sessionReadPromise` convention (the platform
 * SPA shares cross-component state through module singletons, not React
 * context). `useBalance` reads it via `useSyncExternalStore`, so a live refetch
 * repaints every subscribed chip without a remount.
 *
 * Why a store and not a per-mount fetch: the chip used to read
 * `GET /api/companion/assets` once on mount and never refresh, so a balance
 * that changed elsewhere (a win reward, a check-in, a voice-session deduct)
 * stayed stale until the component remounted. The store re-reads the endpoint
 * on the events that mark a return, so a fresh balance reaches the chip.
 *
 * Refresh is event-driven, never polled (no interval): the hook re-reads when
 * the document regains visibility (return from a game SPA / bfcache restore /
 * tab refocus) and when the ledger drawer closes.
 */
import type { AssetEntryView } from '@shared/companion-types'
import { fetchAssets } from '@/lib/companion-api'

/**
 *   - `loading`     — no read has resolved yet; the chip stays empty (mirrors
 *                     the avatar slot's loading hold).
 *   - `ready`       — balance + entries loaded; the chip renders.
 *   - `unavailable` — the FIRST read failed (anonymous 401 / error / malformed):
 *                     the chip renders nothing (never a broken / zero-flashing
 *                     pill). A LATER refresh failure never lands here — a ready
 *                     store keeps its last-known value.
 */
export type BalanceState =
  | { status: 'loading' }
  | { status: 'ready'; balance: number; entries: AssetEntryView[]; welcomeGranted: boolean }
  | { status: 'unavailable' }

const INITIAL_STATE: BalanceState = { status: 'loading' }

let state: BalanceState = INITIAL_STATE
const listeners = new Set<() => void>()

/**
 * De-dup the in-flight read (same shape as `useAuth`'s `sessionReadPromise`):
 * the initial mount and a concurrent drawer read share ONE request rather than
 * firing two. Cleared the moment it settles, so each later event re-reads.
 */
let inFlight: Promise<void> | null = null

/**
 * Monotonic read generation. Every issued read captures the value it bumped to;
 * only the LATEST-issued read may publish (`gen === latestGen`). A slower older
 * read that resolves out of order is discarded, so it can never clobber a newer
 * balance — the guarantee the forced return path relies on.
 */
let latestGen = 0

function emit(): void {
  for (const listener of listeners) listener()
}

function setState(next: BalanceState): void {
  state = next
  emit()
}

/** Subscribe to store changes (the `useSyncExternalStore` subscribe arg). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Current snapshot (the `useSyncExternalStore` getSnapshot arg). Stable by
 *  reference until `setState` replaces it, as the hook requires. */
export function getBalanceSnapshot(): BalanceState {
  return state
}

/**
 * Issue ONE read now, tagged with a fresh generation, and track it as the
 * in-flight request. Publishing follows the chip's contract:
 *   - `anon` (401)        → `unavailable`, ALWAYS — even from `ready` and even
 *                           if this read is STALE. A 401 is authoritative: the
 *                           session is gone (logout in another tab, expired /
 *                           revoked cookie). "Session gone" outranks the
 *                           last-issued-wins ordering, so the private chip must
 *                           clear rather than keep an account balance on screen.
 *   - otherwise           → only the LATEST-issued read publishes. An older read
 *                           that resolves out of order is discarded, so it can
 *                           never clobber a newer balance.
 *       - `ok`            → `ready` with the fresh balance / entries.
 *       - `error`, first  → `unavailable` (the initial-load-empty hide).
 *       - `error`, ready  → KEEP the last-known value (a transient 500 / network
 *                           / malformed refresh must not blank a good chip).
 */
function issueRead(): Promise<void> {
  const gen = ++latestGen
  const pending = fetchAssets()
    .then((result) => {
      if (result.kind === 'anon') {
        setState({ status: 'unavailable' })
        return
      }
      if (gen !== latestGen) return
      if (result.kind === 'ok') {
        setState({
          status: 'ready',
          balance: result.balance,
          entries: result.entries,
          welcomeGranted: result.welcomeGranted,
        })
      } else if (state.status !== 'ready') {
        setState({ status: 'unavailable' })
      }
      // else: `error` while ready → keep the last-known value.
    })
    .finally(() => {
      if (inFlight === pending) inFlight = null
    })
  inFlight = pending
  return pending
}

/**
 * Re-read `GET /api/companion/assets` and publish the result (via `applyResult`).
 *
 * Concurrency: by default a genuinely concurrent read (the initial mount + a
 * drawer open firing together) shares the single in-flight request.
 *
 * `{ force: true }` is the RETURN-event path (visibility / bfcache restore). It
 * must land on a read ISSUED AFTER the return: a request already in flight before
 * the user left predates the win / spend earned in the game, so reusing it — or
 * even waiting behind it — would keep the chip on the OLD balance while a slow or
 * hanging pre-navigation read settles. So force issues a fresh read IMMEDIATELY
 * and relies on the generation guard: the newer read wins, and the older read's
 * late result is discarded rather than overwriting it.
 */
export function reloadBalance(options?: { force?: boolean }): Promise<void> {
  if (options?.force) return issueRead()
  if (inFlight) return inFlight
  return issueRead()
}

/**
 * Reset to the initial loading state. Used by tests to isolate the module
 * singleton between cases; also a clean clear point should a future in-SPA
 * sign-out path replace `useAuth`'s hard navigation.
 */
export function resetBalanceStore(): void {
  state = INITIAL_STATE
  inFlight = null
  latestGen = 0
  emit()
}
