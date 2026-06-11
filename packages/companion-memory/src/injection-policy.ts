/**
 * Injection-policy configuration — the experiment mount point for "when do
 * memories surface" (L2 §Mechanism Variant 2).
 *
 * The mount point (resolver + this config plane) is pinned at L2; the NUMBERS
 * are deliberately configuration, not code constants scattered through the
 * resolver: tuning how many claims / episodes are injected, or what counts as
 * "high salience", is an edit to this file's data — global default + per-game
 * override — never an architecture change.
 */

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
