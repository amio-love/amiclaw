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
 * last-known balance and any update (a live refetch or a pushed reward balance)
 * repaints the chip without a remount — the fix for the mount-once staleness.
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

    const refetchWhenVisible = () => {
      if (document.visibilityState === 'visible') void reloadBalance()
    }
    document.addEventListener('visibilitychange', refetchWhenVisible)
    // `pageshow` fires on a bfcache restore (return from a game via back/forward)
    // where `visibilitychange` may not — cover both so the chip is never stale.
    window.addEventListener('pageshow', refetchWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', refetchWhenVisible)
      window.removeEventListener('pageshow', refetchWhenVisible)
    }
  }, [enabled])

  const reload = useCallback(() => {
    void reloadBalance()
  }, [])

  return { state, reload }
}
