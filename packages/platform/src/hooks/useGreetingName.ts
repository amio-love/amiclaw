import { readChosenArcadeNickname } from '@/lib/arcade-nickname'
import { useCompanion } from './useCompanion'

/**
 * The name to greet a signed-in player by, decided from the shipped design —
 * never the account email (audit F19).
 *
 * Two precedences, by surface (F5):
 *
 *   - Board / account surfaces (default): board nickname → companion-known name
 *     → neutral. The nickname is the board identity, so the account page and
 *     other board-context greetings lead with it.
 *   - Companion surfaces (`preferCompanionName: true` — the homepage welcome
 *     strip, where the companion greets you and the voice already calls you by
 *     the relationship name): companion-known name (`address_style`, e.g. 白舟 /
 *     队长, from GET /api/companion) → board nickname → neutral. This keeps the
 *     companion's spoken name and the greeting consistent instead of the
 *     companion saying 白舟 while the strip says the board nickname.
 *
 * Both fall through to `null` (a NEUTRAL, name-free greeting) when neither is
 * set. The companion read is skipped when the board precedence is in effect and
 * the nickname already decides the name (`enabled: false` to `useCompanion`).
 */
export function useGreetingName(preferCompanionName = false): string | null {
  const nickname = readChosenArcadeNickname()
  const { state } = useCompanion(preferCompanionName || nickname === undefined)
  const companionName =
    state.status === 'exists' ? (state.companion.address_style ?? '').trim() : ''

  if (preferCompanionName) {
    if (companionName.length > 0) return companionName
    if (nickname !== undefined) return nickname
    return null
  }
  if (nickname !== undefined) return nickname
  if (companionName.length > 0) return companionName
  return null
}
