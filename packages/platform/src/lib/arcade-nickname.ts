/**
 * Reads the player's chosen daily nickname so the account claim can adopt it as
 * the public streak-board label (the highest-precedence real name signal — see
 * the arcade label precedence in packages/api/.../arcade-profile.ts).
 *
 * The nickname is written by the BombSquad game SPA under `bombsquad-nickname`.
 * BombSquad and this platform SPA are served from the same origin, so they
 * share localStorage — this reads the same key without coupling to the game
 * package. Returns `undefined` when there is no usable nickname (never set,
 * whitespace-only, or localStorage unavailable), so the caller falls back to
 * the account-derived default instead of forcing an empty label.
 */

// Kept in sync with `NICKNAME_KEY` in packages/game-bombsquad/src/utils/nickname.ts.
const BOMBSQUAD_NICKNAME_KEY = 'bombsquad-nickname'

/** Max length, matched to the game's `NICKNAME_MAX_LENGTH` + the server cap. */
export const ARCADE_NICKNAME_MAX_LENGTH = 20

export function readChosenArcadeNickname(): string | undefined {
  try {
    const raw = localStorage.getItem(BOMBSQUAD_NICKNAME_KEY)
    if (raw === null) return undefined
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch {
    return undefined
  }
}

/** Pure validator — non-empty after trim, within the shared length cap. */
export function isValidArcadeNickname(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= ARCADE_NICKNAME_MAX_LENGTH
}

/**
 * Writes the unified username to the shared `bombsquad-nickname` key so the
 * /me editor (ruling A) can set the public leaderboard handle from the platform
 * SPA — the same key the BombSquad game writes, on the same origin. Returns
 * false on validation or storage failure. The caller updates the account-side
 * `public_label` separately (via the profile claim) so both boards stay unified.
 */
export function writeChosenArcadeNickname(value: string): boolean {
  if (!isValidArcadeNickname(value)) return false
  try {
    localStorage.setItem(BOMBSQUAD_NICKNAME_KEY, value.trim())
    return true
  } catch {
    return false
  }
}
