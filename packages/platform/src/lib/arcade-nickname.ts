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
