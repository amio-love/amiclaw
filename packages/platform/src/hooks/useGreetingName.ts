import { readChosenArcadeNickname } from '@/lib/arcade-nickname'

/**
 * The unified sitewide username to greet a signed-in player by (ruling A):
 * ONE name, based on the PUBLIC leaderboard handle. The home greeting, the /me
 * title, and the leaderboard all show this same name.
 *
 * It is never the account email (audit F19), and — the ruling-A change — never
 * the companion-given intimate name (`address_style`, e.g. 白舟 / 队长). That
 * intimate name appears ONLY inside companion surfaces (the presence bar, the
 * companion card, the onboarding page), never in the home greeting or /me
 * title. Removing the old `preferCompanionName` precedence is what ends the U3
 * split where the leaderboard read「审计员07」while the greeting read「白舟」.
 *
 * The public handle is the board nickname (`bombsquad-nickname`); a signed-in
 * player's account `public_label` is kept in sync with it (the claim adopts it,
 * and the /me username editor writes both), so this synchronous read stays
 * correct without a profile fetch. Returns null when no username is set, so the
 * caller falls back to a neutral, name-free greeting.
 */
export function useGreetingName(): string | null {
  return readChosenArcadeNickname() ?? null
}
