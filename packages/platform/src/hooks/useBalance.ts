import { useCallback, useEffect, useState } from 'react'
import type { AssetEntryView } from '@shared/companion-types'
import { fetchAssets } from '@/lib/companion-api'

/**
 * The signed-in player's starburst balance + recent ledger (`GET
 * /api/companion/assets`). Powers the TopNav balance chip and its tap-through
 * ledger drawer (reward-economy §7).
 *
 *   - `loading`     — the read is in flight (or `enabled` is still false): the
 *                     chip stays empty, mirroring the avatar slot's loading hold.
 *   - `ready`       — balance + entries loaded.
 *   - `unavailable` — anonymous (401) or a read failure: the chip renders
 *                     nothing (never a broken / zero-flashing pill).
 *
 * `reload` re-reads on demand — the drawer calls it on open so the ledger is
 * fresh after a win / spend earned elsewhere in the SPA session.
 */
export type BalanceState =
  | { status: 'loading' }
  | { status: 'ready'; balance: number; entries: AssetEntryView[]; welcomeGranted: boolean }
  | { status: 'unavailable' }

export function useBalance(enabled: boolean): { state: BalanceState; reload: () => void } {
  const [state, setState] = useState<BalanceState>({ status: 'loading' })

  const load = useCallback(() => {
    fetchAssets().then((result) => {
      if (result.kind === 'ok') {
        setState({
          status: 'ready',
          balance: result.balance,
          entries: result.entries,
          welcomeGranted: result.welcomeGranted,
        })
      } else {
        setState({ status: 'unavailable' })
      }
    })
  }, [])

  useEffect(() => {
    if (!enabled) return
    load()
  }, [enabled, load])

  return { state, reload: load }
}
