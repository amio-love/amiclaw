import type { WinReward } from '@shared/reward-types'

export interface ShadowChaseSettlement {
  version: 1
  runId: string
  outcome: 'win' | 'loss' | 'timeout'
  durationTicks: number
}

/** Settlement endpoint success body. `reward` is present only on an
    `outcome: 'win'` that credited the ledger without error (reward-economy §3). */
export interface ShadowChaseSettlementResponse {
  accepted: true
  reward?: WinReward
}
