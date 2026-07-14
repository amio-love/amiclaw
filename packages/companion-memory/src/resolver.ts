/**
 * Companion-context resolver — the read path's assembly-time entry
 * (L2 §Mechanism Variant 2).
 *
 * `userId -> { companion profile, active claim subset, recent + high-salience
 * episode subset }`, sized by the injection policy (global default + per-game
 * override). The result is injected into the LLM context server-side and
 * deterministically, isomorphic to the manual injection — never via model
 * function-calling.
 *
 * Degradations:
 *   no companion          -> null (memory-less session; nothing injected)
 *   profile_enabled=false -> claims always empty (injection stops immediately)
 *   no memories yet       -> empty subsets, companion identity still injected
 *                            (the companion exists from setup, memory or not)
 */

import { deriveFamiliarityTier } from '../../../shared/companion-familiarity'
import type { CompanionDb } from './db'
import { resolveInjectionPolicyForStreak, type InjectionPolicy } from './injection-policy'
import { getCompanion } from './store'
import type { CompanionContext, CompanionContextEpisode } from './types'

interface EpisodeRow {
  id: string
  title: string
  narrative: string
  occurred_at: string
  game_id: string
  source_kind: 'session_summary' | 'settlement'
  salience: number
}

export async function resolveCompanionContext(
  db: CompanionDb,
  userId: string,
  gameId?: string,
  policyOverride?: InjectionPolicy,
  streakDays?: number
): Promise<CompanionContext | null> {
  const companion = await getCompanion(db, userId)
  if (companion === null) return null
  const policy = policyOverride ?? resolveInjectionPolicyForStreak(gameId, streakDays ?? 0)

  // Claims: only while the profile switch is on, and only claims holding >=1
  // ACTIVE evidence episode (the no-black-box invariant, read-side).
  let claims: CompanionContext['claims'] = []
  if (companion.profile_enabled === 1 && policy.maxClaims > 0) {
    const { results } = await db
      .prepare(
        `SELECT pc.dimension, pc.claim
         FROM profile_claim pc
         WHERE pc.user_id = ? AND pc.status = 'active'
           AND EXISTS (
             SELECT 1 FROM profile_claim_evidence pce
             JOIN episode e ON e.id = pce.episode_id
             WHERE pce.profile_claim_id = pc.id AND e.status = 'active'
           )
         ORDER BY pc.updated_at DESC, pc.id DESC
         LIMIT ?`
      )
      .bind(userId, policy.maxClaims)
      .all<{ dimension: string; claim: string }>()
    claims = results
  }

  // Episodes: most-recent slot + high-salience slot, deduped, recency first.
  const { results: recent } = await db
    .prepare(
      `SELECT id, title, narrative, occurred_at, game_id, source_kind, salience
       FROM episode
       WHERE user_id = ? AND status = 'active'
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    )
    .bind(userId, policy.recentEpisodes)
    .all<EpisodeRow>()
  const { results: salient } = await db
    .prepare(
      `SELECT id, title, narrative, occurred_at, game_id, source_kind, salience
       FROM episode
       WHERE user_id = ? AND status = 'active' AND salience >= ?
       ORDER BY salience DESC, occurred_at DESC, id DESC
       LIMIT ?`
    )
    .bind(userId, policy.minSalience, policy.salientEpisodes)
    .all<EpisodeRow>()

  const seen = new Set<string>()
  const episodes: CompanionContextEpisode[] = []
  for (const row of [...recent, ...salient]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    episodes.push({
      title: row.title,
      narrative: row.narrative,
      occurred_at: row.occurred_at,
      game_id: row.game_id,
      source_kind: row.source_kind,
      salience: row.salience,
    })
  }

  // Familiarity (B9 叙事型成长): attach only once the relationship has reached
  // the first tier AND a streak was supplied. Below the first tier — or with no
  // streak passed — nothing is attached, so the injected prompt is byte-identical
  // to the pre-B9 shape (a young relationship shapes no register).
  const tier = deriveFamiliarityTier(streakDays ?? 0)

  return {
    companion: {
      name: companion.name,
      address_style: companion.address_style,
      voice_id: companion.voice_id,
    },
    claims,
    episodes,
    ...(streakDays !== undefined && tier !== 'newcomer'
      ? { familiarity: { streakDays, tier } }
      : {}),
  }
}
