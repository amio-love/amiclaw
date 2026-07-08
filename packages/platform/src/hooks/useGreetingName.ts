import { readChosenArcadeNickname } from '@/lib/arcade-nickname'
import { useCompanion } from './useCompanion'

/**
 * The name to greet a signed-in player by, decided from the shipped design —
 * never the account email (audit F19):
 *
 *   1. the player's chosen board nickname (leaderboard identity), if set;
 *   2. else the companion-known user name — the companion's `address_style`
 *      (「它怎么称呼你」, e.g. 白舟 / 队长), read from GET /api/companion;
 *   3. else `null` → the caller renders a NEUTRAL, name-free greeting.
 *
 * The companion read is skipped entirely when the nickname already decides the
 * name (the hook passes `enabled: false` to `useCompanion`). `address_style` is
 * optional in onboarding, so an empty / missing value falls through to neutral.
 */
export function useGreetingName(): string | null {
  const nickname = readChosenArcadeNickname()
  const { state } = useCompanion(nickname === undefined)

  if (nickname !== undefined) return nickname
  if (state.status === 'exists') {
    const known = (state.companion.address_style ?? '').trim()
    if (known.length > 0) return known
  }
  return null
}
