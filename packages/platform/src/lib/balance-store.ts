/**
 * Shared starburst-balance store — the single last-known-balance source the
 * TopNav `BalanceChip` subscribes to (reward-economy §7). A module-level
 * singleton, mirroring `useAuth`'s `sessionReadPromise` convention (the platform
 * SPA shares cross-component state through module singletons, not React
 * context). `useBalance` reads it via `useSyncExternalStore`, so any update —
 * a live refetch or a pushed reward balance — repaints every subscribed chip
 * without a remount.
 *
 * Why a store and not a per-mount fetch: the chip used to read
 * `GET /api/companion/assets` once on mount and never refresh, so a balance
 * that changed elsewhere (a win reward, a check-in, a voice-session deduct)
 * stayed stale until the component remounted. The store lets a fresh balance
 * reach the chip immediately — either the endpoint is re-read (a live event) or
 * a balance-changing response pushes its `balance` straight in.
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
 * the initial mount and a concurrent visibility refetch share ONE request
 * rather than firing two. Cleared the moment it settles, so each later event
 * still re-reads a fresh balance.
 */
let inFlight: Promise<void> | null = null

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
 * Re-read `GET /api/companion/assets` and publish the result. Graceful
 * degradation matches the chip's contract:
 *   - success            → `ready` with the fresh balance / entries.
 *   - failure, not-ready  → `unavailable` (the initial-load-empty hide).
 *   - failure, ready      → KEEP the last-known value (a transient refresh
 *                           failure must not blank a good chip).
 * Concurrent calls share the single in-flight read.
 */
export function reloadBalance(): Promise<void> {
  if (inFlight) return inFlight
  const pending = fetchAssets()
    .then((result) => {
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
      // else: refresh failed while ready → keep the last-known value.
    })
    .finally(() => {
      inFlight = null
    })
  inFlight = pending
  return pending
}

/**
 * Push a fresh balance carried by a balance-changing response (a settlement win
 * reward, a check-in credit) so the chip reflects it immediately — no
 * round-trip. Only the numeric balance moves; the ledger `entries` and the
 * one-time `welcomeGranted` beat are left untouched (a later read refreshes the
 * ledger; the drawer already shows the credited row's source). Ignored before
 * the first successful read: the initial `reloadBalance` owns first paint, and a
 * push has no ledger context to attach to.
 */
export function pushBalance(balance: number): void {
  if (state.status === 'ready') {
    setState({ ...state, balance })
  }
}

/**
 * Reset to the initial loading state. Used by tests to isolate the module
 * singleton between cases; also a clean clear point should a future in-SPA
 * sign-out path replace `useAuth`'s hard navigation.
 */
export function resetBalanceStore(): void {
  state = INITIAL_STATE
  inFlight = null
  emit()
}
