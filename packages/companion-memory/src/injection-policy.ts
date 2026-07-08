/**
 * Injection-policy configuration — the experiment mount point for "when do
 * memories surface" (L2 §Mechanism Variant 2).
 *
 * The mount point (resolver + this config plane) is pinned at L2; the NUMBERS
 * are deliberately configuration, not code constants scattered through the
 * resolver: tuning how many claims / episodes are injected, or what counts as
 * "high salience", is an edit to this file's data — global default + per-game
 * override + streak-tier bonus — never an architecture change.
 */

import { deriveFamiliarityTier, type FamiliarityTier } from '../../../shared/companion-familiarity'

export interface InjectionPolicy {
  /** Max active profile claims injected per session. */
  maxClaims: number
  /** Most-recent active episodes injected per session. */
  recentEpisodes: number
  /** Additional high-salience episodes injected (deduped against recent). */
  salientEpisodes: number
  /** Minimum salience (0-100) for the high-salience slot. */
  minSalience: number
}

/** Global default policy. Reasonable starting values, awaiting prototype data. */
export const DEFAULT_INJECTION_POLICY: InjectionPolicy = {
  maxClaims: 5,
  recentEpisodes: 3,
  salientEpisodes: 2,
  minSalience: 70,
}

/**
 * Per-game overrides, keyed by `gameId`. Empty today; a game that wants a
 * different memory budget adds a partial entry here.
 */
export const GAME_INJECTION_OVERRIDES: Record<string, Partial<InjectionPolicy>> = {}

/** Resolve the effective policy for a game (global default + per-game override). */
export function resolveInjectionPolicy(gameId?: string): InjectionPolicy {
  const override = gameId === undefined ? undefined : GAME_INJECTION_OVERRIDES[gameId]
  return { ...DEFAULT_INJECTION_POLICY, ...override }
}

/**
 * Per-tier additive bonus to the memory-injection budget (B9 叙事型成长 (b) —
 * memory-reference frequency rises with the streak). Config-as-data on the same
 * plane as `DEFAULT_INJECTION_POLICY`: raising how much a long-streak companion
 * recalls is an edit to these numbers, never a resolver change. Restrained — the
 * salience floor and the high-salience slot are untouched; only recency depth
 * and claim count grow, so a familiar companion recalls MORE of the recent
 * shared history, not more noise.
 */
export const STREAK_TIER_POLICY_BONUS: Record<
  FamiliarityTier,
  Pick<InjectionPolicy, 'maxClaims' | 'recentEpisodes'>
> = {
  newcomer: { maxClaims: 0, recentEpisodes: 0 },
  familiar: { maxClaims: 1, recentEpisodes: 1 },
  close: { maxClaims: 2, recentEpisodes: 2 },
}

/**
 * Resolve the effective policy for a game AND the player's streak tier: the base
 * policy (global default + per-game override) plus the streak-tier bonus. A
 * newcomer (a sub-week streak, or a session that carries no streak) resolves to
 * the EXACT base policy — the streak seam is byte-identical below the first tier,
 * so it changes nothing until the relationship has actually accrued.
 */
export function resolveInjectionPolicyForStreak(
  gameId: string | undefined,
  streakDays: number
): InjectionPolicy {
  const base = resolveInjectionPolicy(gameId)
  const bonus = STREAK_TIER_POLICY_BONUS[deriveFamiliarityTier(streakDays)]
  return {
    ...base,
    maxClaims: base.maxClaims + bonus.maxClaims,
    recentEpisodes: base.recentEpisodes + bonus.recentEpisodes,
  }
}
