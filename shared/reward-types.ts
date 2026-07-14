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

/* Player-facing presentation of the starburst currency (L2 design §8): code and
   the wire use `starburst`; every UI surface renders the star mark in the brand
   channel plus the localized name 星芒. Kept beside the wire type so the balance
   chip, the settlement reward drop, and the check-in beat all read one source —
   no per-surface copy of the glyph / name (DesignSystem Hard Prohibition #7: the
   star mark rides `--amio-yellow`, no new hue). */
export const STARBURST_GLYPH = '✦'
export const STARBURST_LABEL = '星芒'

/* Player-facing copy for the voice reward-economy intercepts (design §7 mockup
   #4). Shared so the three voice panels (shadow-chase / bombsquad / sound-garden)
   read one source instead of three drifting phrasings. Each panel may append a
   game-local clause (e.g. shadow-chase adds its own "strategy buttons still work"
   note). NO companion-voice narration — these are on-screen beats only (locked
   Boundary). */
export const STARBURST_EARN_CTA_LABEL = '去攒星芒'
export const STARBURST_INSUFFICIENT_LEAD = '星芒用完了，伙伴得攒够星芒才能开口。'
export const STARBURST_DEPLETED_FAREWELL = '这局的星芒聊完了，伙伴先陪你到这，赢下来我们再接着聊。'
