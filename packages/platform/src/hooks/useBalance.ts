import { useCallback, useEffect, useSyncExternalStore } from 'react'
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

  useEffect(() => {
    if (!enabled) return
    void reloadBalance()

    // A forced return-refetch must not run until the initial read has landed.
    // The initial read owns first paint AND the one-time +10 welcome beat; a
    // forced read that raced ahead of it would supersede it under the generation
    // guard, dropping its `welcome_granted`, so the beat would never render.
    const initialReadLanded = () => getBalanceSnapshot().status !== 'loading'

    const refetchWhenVisible = () => {
      // `force`: a read issued AFTER the return. A request left in flight before
      // the user departed predates the win / spend earned in the game and would
      // repaint the old balance, so the return path must not reuse it.
      if (initialReadLanded() && document.visibilityState === 'visible') {
        void reloadBalance({ force: true })
      }
    }
    const refetchOnRestore = (event: PageTransitionEvent) => {
      // `pageshow` also fires on a NORMAL initial load, not only a bfcache
      // restore. Gate on `persisted` (true only for a real back/forward restore)
      // — refetching on a normal load would fire a redundant second read that,
      // for a brand-new account, flips `welcomeGranted` back to false and hides
      // the one-time +10 welcome beat before the user sees it.
      if (event.persisted && initialReadLanded()) void reloadBalance({ force: true })
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

  const reload = useCallback(() => {
    void reloadBalance()
  }, [])

  return { state, reload }
}
