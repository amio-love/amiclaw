/* Wire shape for a settlement win reward, returned by the score-submission and
   shadow-chase settlement endpoints when an authenticated win credits the
   ledger (reward-economy L2 design §3). The `status` mirrors the crediting
   `CreditWinResult` MINUS `error`: an `error` result is fail-open — the
   settlement still succeeds and the handler OMITS this field entirely, so a
   present `reward` is always one of the three non-error outcomes. */
export interface WinReward {
  asset_type: 'starburst'
  /** +5 on `credited`; 0 on `duplicate` (run replay) / `capped` (daily cap). */
  amount: number
  status: 'credited' | 'duplicate' | 'capped'
  /** Balance after this settlement — immediately spendable. */
  balance: number
}
