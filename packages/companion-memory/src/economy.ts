/**
 * Reward-economy numeric SSOT (L2 design §1).
 *
 * Every reward/deduct amount, the daily win cap, the per-minute session price,
 * and the minimum session balance live here as named constants — no magic
 * number is duplicated at a call site. `starburst` is the earn-currency
 * asset_type on the product-agnostic `asset_entry` ledger; the UI renders its
 * localized currency name (see docs/DesignSystem.md).
 *
 * The emergent 23-per-day earn ceiling is arithmetic, not a constant:
 * DAILY_WIN_CAP * WIN_REWARD + CHECKIN_REWARD = 4 * 5 + 3 = 23.
 */

/**
 * asset_type for the earn currency. Distinct from the taken `starlight` /
 * `starpower` match-3 currencies (design §8).
 */
export const ASSET_TYPE_STARBURST = 'starburst' as const

/** +5 per rewarded game win. */
export const WIN_REWARD = 5

/** +3 on the first qualified activity of the UTC day. */
export const CHECKIN_REWARD = 3

/** +10 one-time welcome grant (once ever per user). */
export const WELCOME_GRANT = 10

/** Rewarded wins per user per UTC day, COMBINED across games (design §3). */
export const DAILY_WIN_CAP = 4

/** Voice-session price: 1 starburst per elapsed minute. */
export const STARBURST_PER_MINUTE = 1

/** Minimum balance to open a voice session. */
export const MIN_SESSION_BALANCE = 1
