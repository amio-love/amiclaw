import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  getBalanceSnapshot,
  reloadBalance,
  subscribe,
  type BalanceState,
} from '@/lib/balance-store'

export type { BalanceState }

/**
 * The signed-in player's starburst balance + recent ledger, read from the
 * shared balance store (`GET /api/companion/assets`). Powers the TopNav balance
 * chip and its tap-through ledger drawer (reward-economy §7).
 *
 * The store is a module singleton, so every subscriber sees the same
 * last-known balance and a live refetch repaints the chip without a remount —
 * the fix for the mount-once staleness.
 *
 * On enable the hook does the initial read, then keeps the balance live with an
 * event-driven refetch (NO polling): it re-reads whenever the document regains
 * visibility — returning from a game SPA (a full navigation or a bfcache
 * restore) or refocusing the tab — which is when a balance earned/spent
 * elsewhere needs to catch up. `reload` re-reads on demand (the drawer calls it
 * on open and close so the ledger and balance stay fresh).
 */
export function useBalance(enabled: boolean): { state: BalanceState; reload: () => void } {
  const state = useSyncExternalStore(subscribe, getBalanceSnapshot)

  // A return event fired while the initial read is still in flight is QUEUED, not
  // dropped: forcing a refetch now would race ahead of the initial read (which
  // owns first paint + the one-time +10 welcome beat) and supersede it under the
  // generation guard. But dropping it would strand the quick-return case — a user
  // who left for a game before the initial read resolved would keep the stale
  // pre-game balance with no later event guaranteed to fire. So we record the
  // request and run ONE deferred refetch once the initial read lands.
  const returnRefetchQueued = useRef(false)

  useEffect(() => {
    if (!enabled) return
    void reloadBalance()

    const requestReturnRefetch = () => {
      // Before the initial read lands, queue; after, refetch immediately. Either
      // way the read is issued AFTER the return, so it reflects a balance
      // earned / spent in the game rather than reusing the pre-departure read.
      if (getBalanceSnapshot().status === 'loading') {
        returnRefetchQueued.current = true
      } else {
        void reloadBalance({ force: true })
      }
    }

    const refetchWhenVisible = () => {
      if (document.visibilityState === 'visible') requestReturnRefetch()
    }
    const refetchOnRestore = (event: PageTransitionEvent) => {
      // `pageshow` also fires on a NORMAL initial load, not only a bfcache
      // restore. Gate on `persisted` (true only for a real back/forward restore)
      // so a normal load does not trigger an extra read.
      if (event.persisted) requestReturnRefetch()
    }
    document.addEventListener('visibilitychange', refetchWhenVisible)
    // A bfcache restore (return from a game via back/forward) may not fire
    // `visibilitychange`, so cover it via `pageshow` — but only a persisted one.
    window.addEventListener('pageshow', refetchOnRestore)
    return () => {
      document.removeEventListener('visibilitychange', refetchWhenVisible)
      window.removeEventListener('pageshow', refetchOnRestore)
    }
  }, [enabled])

  // When the initial read lands, run the deferred return refetch (if one was
  // requested during loading). It runs strictly AFTER the initial read resolved,
  // so the +10 welcome beat is preserved AND the post-return balance still lands.
  useEffect(() => {
    if (state.status === 'loading') return
    if (returnRefetchQueued.current) {
      returnRefetchQueued.current = false
      void reloadBalance({ force: true })
    }
  }, [state.status])

  const reload = useCallback(() => {
    void reloadBalance()
  }, [])

  return { state, reload }
}
