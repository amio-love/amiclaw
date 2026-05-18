/**
 * Player nickname collection for the daily leaderboard.
 *
 * The first time a player reaches ResultPage on a daily run with no stored
 * nickname, NicknameModal is shown and submission is blocked until they enter
 * a valid value. Subsequent daily runs on the same device reuse the stored
 * value. Validation matches the server-side cap in `shared/leaderboard-types.ts`
 * (max 20 chars after trim, non-empty, whitespace-only rejected).
 */

const NICKNAME_KEY = 'bombsquad-nickname'

export const NICKNAME_MAX_LENGTH = 20

/** Pure validator used by the modal to enable/disable the confirm button. */
export function isValidNickname(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= NICKNAME_MAX_LENGTH
}

/**
 * Returns the trimmed stored nickname, or null when:
 *  - localStorage is empty for this key
 *  - the stored value is whitespace-only (defensive against external edits)
 *  - the stored value exceeds NICKNAME_MAX_LENGTH (corrupted from older code)
 *  - localStorage access throws (private mode / disabled)
 */
export function getStoredNickname(): string | null {
  try {
    const raw = localStorage.getItem(NICKNAME_KEY)
    if (raw === null) return null
    const trimmed = raw.trim()
    if (!isValidNickname(trimmed)) return null
    return trimmed
  } catch {
    return null
  }
}

/**
 * Validates, trims, and writes the value. Returns true on success, false on
 * either validation failure or storage failure (quota exceeded, private mode).
 * Caller (NicknameModal) keeps the modal open and surfaces a brief error if
 * false is returned.
 */
export function setStoredNickname(value: string): boolean {
  if (!isValidNickname(value)) return false
  const trimmed = value.trim()
  try {
    localStorage.setItem(NICKNAME_KEY, trimmed)
    return true
  } catch {
    return false
  }
}
