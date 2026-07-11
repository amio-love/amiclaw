/**
 * Reward-economy numeric SSOT (L2 design §1).
 *
 * Every reward/deduct amount, the daily win cap, the per-minute session price,
 * and the minimum session balance live here as named constants — no magic
 * number is duplicated at a call site. `星芒` (the UI-rendered currency name) is
 * the `starburst` asset_type on the product-agnostic `asset_entry` ledger;
 * identifiers and comments stay English, only rendered strings are Chinese.
 *
 * The emergent 23-星芒/day earn ceiling is arithmetic, not a constant:
 * DAILY_WIN_CAP * WIN_REWARD + CHECKIN_REWARD = 4 * 5 + 3 = 23.
 */

/** asset_type for 星芒. Distinct from the taken 星光/星能 三消 currencies (design §8). */
export const ASSET_TYPE_STARBURST = 'starburst' as const

/** +5 星芒 per rewarded game win. */
export const WIN_REWARD = 5

/** +3 星芒 on the first qualified activity of the UTC day. */
export const CHECKIN_REWARD = 3

/** +10 星芒 one-time welcome grant (once ever per user). */
export const WELCOME_GRANT = 10

/** Rewarded wins per user per UTC day, COMBINED across games (design §3). */
export const DAILY_WIN_CAP = 4

/** Voice-session price: 1 星芒 per elapsed minute. */
export const STARBURST_PER_MINUTE = 1

/** Minimum balance to open a voice session. */
export const MIN_SESSION_BALANCE = 1
