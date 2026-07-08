/**
 * Companion familiarity — pure streak → relationship logic (B9 叙事型成长 + B20
 * 里程碑).
 *
 * SSOT for the streak-driven narrative rules from companion-presence-design
 * §主动性节拍 4 and the arcade closure plan's fork ②B (streak growth is
 * expressed through the companion's FAMILIARITY, never numbers / rewards /
 * badges — the vision's anti-anxiety principle holds):
 *
 *  - the 3-tier familiarity ladder (初识 / 熟络 / 默契) a streak maps to, and how
 *    each tier shifts the companion's register (client address rule + server
 *    prompt tone hint);
 *  - the milestone thresholds (7 / 14 / 30 / 60 days) and the once-per-milestone
 *    pick that resolves the 7→14 double-crossing edge.
 *
 * PURE and dependency-free (no browser globals, no I/O, no imports) so ONE tier
 * definition is consumed by both sides of the boundary: the browser presence
 * layer (`shared/companion-presence.ts`, `@amiclaw/platform`, `@amiclaw/game-
 * bombsquad`) AND the Workers read path (`packages/companion-memory`
 * injection-policy + resolver, which the Workers typecheck compiles). Keep it
 * free of `window` / `Storage` / DOM so the Workers typecheck accepts it (unlike
 * the browser-only `shared/companion-presence.ts`).
 */

// --- Familiarity tiers (B9) ---------------------------------------------------

/** The relationship ladder a streak maps to (design: 陌生 → 熟悉). */
export type FamiliarityTier = 'newcomer' | 'familiar' | 'close'

/**
 * Tier thresholds in streak-days, aligned with the early milestones so the
 * register shift and the milestone beat move together (a week in the companion
 * warms; a month in it is at ease). Below the first threshold everything is
 * byte-identical to the pre-B9 behaviour — a young relationship shapes nothing.
 */
export const FAMILIAR_STREAK_DAYS = 7
export const CLOSE_STREAK_DAYS = 30

export function deriveFamiliarityTier(streakDays: number): FamiliarityTier {
  if (streakDays >= CLOSE_STREAK_DAYS) return 'close'
  if (streakDays >= FAMILIAR_STREAK_DAYS) return 'familiar'
  return 'newcomer'
}

/**
 * Client copy rule (B9a 称呼): the newcomer tier keeps the fuller address (the
 * companion names the player), the warmer tiers drop the explicit address for a
 * closer register — a friend does not announce your name every sentence.
 */
export function tierUsesAddressPrefix(tier: FamiliarityTier): boolean {
  return tier === 'newcomer'
}

/**
 * Server prompt tone guidance (B9c). An English platform instruction (the
 * system prompt is English) that shapes the companion's Chinese speech register.
 * `null` for the base tier — nothing is injected, so a sub-week session's prompt
 * is byte-identical to the pre-B9 shape.
 */
export function familiarityRegisterHint(tier: FamiliarityTier): string | null {
  switch (tier) {
    case 'newcomer':
      return null
    case 'familiar':
      return (
        'You and the player have been showing up together for a while now; ' +
        'you may speak in a warmer, more familiar tone and lean on your shared ' +
        'memories a little more.'
      )
    case 'close':
      return (
        'You know this player well by now; speak with the ease of an old ' +
        'partner — you may drop formal address and reference your shared ' +
        'history naturally.'
      )
  }
}

// --- Milestones (B20) ---------------------------------------------------------

/** The streak lengths that earn one narrative milestone beat (design 节拍 4). */
export const MILESTONE_STREAK_DAYS = [7, 14, 30, 60] as const
export type MilestoneStreakDay = (typeof MILESTONE_STREAK_DAYS)[number]

/** Human time-scale label for a milestone (design 文案示例 register). */
export function milestoneLabel(day: MilestoneStreakDay): string {
  switch (day) {
    case 7:
      return '一周'
    case 14:
      return '两周'
    case 30:
      return '一个月'
    case 60:
      return '两个月'
  }
}

export interface MilestonePick {
  /** The single milestone to announce now — the highest newly reached. */
  fire: MilestoneStreakDay
  /**
   * Every threshold to mark consumed: the fired one plus any LOWER thresholds
   * this visit crossed at once (the 7→14 double-crossing edge). A player who
   * returns already past two milestones sees only the higher beat once; the
   * lower one is retired silently — you never go back to being a week in.
   */
  consumed: MilestoneStreakDay[]
}

/**
 * Pick the milestone to announce for a current streak, given the thresholds
 * already fired (persistent, once-per-milestone-for-life dedup). Returns the
 * highest un-fired threshold at or below the streak, and every un-fired
 * threshold ≤ streak as `consumed` (so the double-crossing edge fires ONE beat
 * and silently retires the lower). `null` when no un-fired threshold is reached.
 */
export function pickMilestone(streakDays: number, fired: readonly number[]): MilestonePick | null {
  const firedSet = new Set(fired)
  const reached = MILESTONE_STREAK_DAYS.filter((day) => streakDays >= day && !firedSet.has(day))
  if (reached.length === 0) return null
  return { fire: reached[reached.length - 1], consumed: reached }
}
