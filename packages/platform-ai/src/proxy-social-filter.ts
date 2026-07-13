/**
 * Companion-proxy-social public-generation filter — the auditable privacy seam
 * (L2 arch-component-proxy-social §生成上下文的隐私过滤 / §注入范围).
 *
 * Both proxy generation routes (V1 message, V2 reply) resolve the author's / the
 * responder's companion via `resolveCompanionContext` (game-global, no gameId)
 * and then pass the result through THIS filter before any of it reaches a PUBLIC
 * generation prompt. The filter is a STRUCTURAL boundary, not prompt wording:
 *
 *  - `PublicProxyContext` has NO `claims` and NO `familiarity` field, so the
 *    profile understanding-layer claims can never reach a public proxy prompt —
 *    excluded at the type level (compile-time) AND at runtime (this function only
 *    ever copies `companion.name` / `companion.address_style` + filtered
 *    episodes; it never copies `claims` / `familiarity` / `voice_id`).
 *  - Episodes converge on a SOURCE allowlist: only game-sourced kinds
 *    (`session_summary` / `settlement`) survive; any future non-game
 *    `source_kind` is dropped by default (allowlist, not denylist). Survivors are
 *    ranked by salience (desc), hard-capped to `MAX_PUBLIC_PROXY_EPISODES`, and
 *    each episode narrative is truncated to `MAX_EPISODE_CONTEXT_CODEPOINTS`
 *    before it is injected (a cheap content bound alongside the source-dimension
 *    exclusion).
 *
 * The exclusion is a SOURCE-dimension guarantee (no claims, only game-sourced
 * episodes) — it does not judge the semantic safety of a single game episode's
 * body; the per-episode length cap is the accompanying cheap content bound, and
 * the residual content-safety risk is the explicitly-accepted v1 residual risk
 * (spec §Residual-risk acceptance). The filter's existence + `PublicProxyContext`
 * shape + the allowlist are the point reviewers and tests structurally guard.
 */

import type { CompanionContext } from '../../companion-memory/src/types'

/** Hard cap on episodes injected into a public proxy prompt (after allowlist +
    salience ranking). Kept below the resolver's typical output so the public
    surface is a tight, high-salience subset of already-injectable memory. */
export const MAX_PUBLIC_PROXY_EPISODES = 4

/** Per-episode narrative codepoint bound before injection — a cheap content
    bound in the same order of magnitude as the route output caps. */
export const MAX_EPISODE_CONTEXT_CODEPOINTS = 256

/** Game-source episode kinds allowed into a PUBLIC proxy prompt. Allowlist: any
    future non-game `source_kind` is excluded by default. */
const PROXY_EPISODE_SOURCE_KIND_ALLOWLIST: ReadonlySet<string> = new Set([
  'session_summary',
  'settlement',
])

/** One episode as it enters a public proxy prompt — the narrative is already
    truncated to `MAX_EPISODE_CONTEXT_CODEPOINTS`. Carries no salience / source
    metadata (they are filter inputs, not injected material). */
export interface PublicProxyEpisode {
  title: string
  narrative: string
  occurred_at: string
  game_id: string
}

/**
 * The filtered, PUBLIC-safe generation context. Structurally free of profile
 * claims, familiarity, and voice — only the companion's public-facing identity
 * (name + address style) and the allowlisted game episodes survive. This shape
 * is the compile-time half of the privacy boundary: there is simply no field a
 * claim / familiarity signal could occupy.
 */
export interface PublicProxyContext {
  companion: {
    name: string
    address_style: string
  }
  episodes: PublicProxyEpisode[]
}

/** Codepoint-aware truncation (never splits an astral codepoint). */
function truncateToCodepoints(value: string, max: number): string {
  const codepoints = [...value]
  return codepoints.length <= max ? value : codepoints.slice(0, max).join('')
}

/**
 * Filter a resolved companion context down to the public-safe proxy context.
 * Drops claims + familiarity (structurally — they have no home in the output),
 * keeps only allowlisted game episodes, ranks them by salience, hard-caps the
 * count, and truncates each narrative. Deterministic and side-effect free (does
 * not mutate the input).
 */
export function filterPublicGenerationContext(ctx: CompanionContext): PublicProxyContext {
  const episodes = ctx.episodes
    .filter(
      (episode) =>
        episode.source_kind !== undefined &&
        PROXY_EPISODE_SOURCE_KIND_ALLOWLIST.has(episode.source_kind)
    )
    .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
    .slice(0, MAX_PUBLIC_PROXY_EPISODES)
    .map((episode) => ({
      title: episode.title,
      narrative: truncateToCodepoints(episode.narrative, MAX_EPISODE_CONTEXT_CODEPOINTS),
      occurred_at: episode.occurred_at,
      game_id: episode.game_id,
    }))
  return {
    companion: {
      name: ctx.companion.name,
      address_style: ctx.companion.address_style,
    },
    episodes,
  }
}
