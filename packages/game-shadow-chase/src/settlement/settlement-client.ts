import type { WinReward } from '@shared/reward-types'
import type { ShadowChaseSettlement, ShadowChaseSettlementResponse } from './settlement-contract'

/**
 * Best-effort settlement hand-off. Still ONE keepalive request with no retry
 * (an abrupt unload must not stall), but the success body is now parsed so the
 * caller can render the win reward drop (reward-economy §3). Fail-open: any
 * network / non-ok / parse failure resolves to `null` (no drop), never throws —
 * settlement is fire-and-forget from the game's point of view.
 */
export async function handoffSettlement(
  settlement: ShadowChaseSettlement
): Promise<WinReward | null> {
  try {
    const res = await fetch('/api/shadow-chase/settlement', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settlement),
    })
    if (!res.ok) return null
    const data = (await res.json()) as ShadowChaseSettlementResponse
    return data.reward ?? null
  } catch {
    return null
  }
}
