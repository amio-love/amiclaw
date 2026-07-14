import type { WinReward } from '@shared/reward-types'

export interface ShadowChaseSettlement {
  version: 1
  /** Seed-derived deterministic run id — game-run provenance only (game_run_id). */
  runId: string
  /**
   * Per-attempt settlement identity (fresh UUID minted at run start). This — NOT
   * the deterministic `runId` — is the idempotency component for the win reward
   * and the settlement capture, so distinct attempts credit while a retry of the
   * same attempt dedups.
   */
  attemptId: string
  outcome: 'win' | 'loss' | 'timeout'
  durationTicks: number
}

/** Settlement endpoint success body. `reward` is present only on an
    `outcome: 'win'` that credited the ledger without error (reward-economy §3). */
export interface ShadowChaseSettlementResponse {
  accepted: true
  reward?: WinReward
}
