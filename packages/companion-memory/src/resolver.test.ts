/**
 * Read-path tests: the companion-context resolver's degradation matrix and
 * injection-policy sizing, plus the read-side evidence invariant.
 */

import { describe, expect, it } from 'vitest'
import type { CompanionDb } from './db'
import {
  DEFAULT_INJECTION_POLICY,
  resolveInjectionPolicy,
  resolveInjectionPolicyForStreak,
} from './injection-policy'
import { resolveCompanionContext } from './resolver'
import { createTestDb } from './test-support/sqlite-db'

const NOW = '2026-06-11T10:00:00.000Z'

async function seedCompanion(
  db: CompanionDb,
  userId: string,
  profileEnabled = true
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO companion (user_id, name, address_style, voice_id, profile_enabled, created_at)
       VALUES (?, 'Ami', 'captain', 'companion-warm', ?, ?)`
    )
    .bind(userId, profileEnabled ? 1 : 0, NOW)
    .run()
}

async function seedEpisode(
  db: CompanionDb,
  id: string,
  userId: string,
  occurredAt: string,
  salience = 50,
  status: 'active' | 'deleted' = 'active'
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO episode (id, user_id, occurred_at, game_id, title, narrative, source_kind, source_ref, source_key, salience, status, created_at)
       VALUES (?, ?, ?, 'bombsquad', ?, 'Narrative.', 'settlement', 'evt', ?, ?, ?, ?)`
    )
    .bind(id, userId, occurredAt, `Title ${id}`, `key-${id}`, salience, status, NOW)
    .run()
}

async function seedClaimWithEvidence(
  db: CompanionDb,
  claimId: string,
  userId: string,
  episodeId: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profile_claim (id, user_id, dimension, claim, status, created_at, updated_at)
       VALUES (?, ?, 'play-style', ?, 'active', ?, ?)`
    )
    .bind(claimId, userId, `Claim ${claimId}`, NOW, NOW)
    .run()
  await db
    .prepare(
      `INSERT INTO profile_claim_evidence (profile_claim_id, episode_id, created_at) VALUES (?, ?, ?)`
    )
    .bind(claimId, episodeId, NOW)
    .run()
}

describe('resolveCompanionContext', () => {
  it('returns null when the user has no companion', async () => {
    const db = createTestDb()
    expect(await resolveCompanionContext(db, 'nobody')).toBeNull()
  })

  it('returns the companion identity with empty subsets when there are no memories yet', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    const context = await resolveCompanionContext(db, 'user-a')
    expect(context).toEqual({
      companion: { name: 'Ami', address_style: 'captain', voice_id: 'companion-warm' },
      claims: [],
      episodes: [],
    })
  })

  it('injects claims and episodes when present', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    await seedEpisode(db, 'ep-1', 'user-a', '2026-06-10T10:00:00.000Z')
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')
    const context = await resolveCompanionContext(db, 'user-a')
    expect(context?.claims).toEqual([{ dimension: 'play-style', claim: 'Claim cl-1' }])
    expect(context?.episodes).toHaveLength(1)
    // source_kind + salience are passed through for the proxy-social public
    // filter (which needs them for the allowlist + salience ranking).
    expect(context?.episodes[0]).toMatchObject({
      title: 'Title ep-1',
      game_id: 'bombsquad',
      source_kind: 'settlement',
      salience: 50,
    })
  })

  it('profile_enabled=false yields no claims while episodes still inject', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a', false)
    await seedEpisode(db, 'ep-1', 'user-a', '2026-06-10T10:00:00.000Z')
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')
    const context = await resolveCompanionContext(db, 'user-a')
    expect(context?.claims).toEqual([])
    expect(context?.episodes).toHaveLength(1)
  })

  it('never injects a claim without at least one ACTIVE evidence episode', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    // A claim inserted with NO evidence at all (trigger bypass scenario).
    await db
      .prepare(
        `INSERT INTO profile_claim (id, user_id, dimension, claim, status, created_at, updated_at)
         VALUES ('cl-bare', 'user-a', 'play-style', 'Evidence-free', 'active', ?, ?)`
      )
      .bind(NOW, NOW)
      .run()
    // A claim whose only evidence episode is deleted directly (status flip
    // without the trigger seeing an active->deleted edge is impossible here,
    // so seed the episode already deleted and link by hand).
    await seedEpisode(db, 'ep-dead', 'user-a', NOW, 50, 'deleted')
    await db
      .prepare(
        `INSERT INTO profile_claim (id, user_id, dimension, claim, status, created_at, updated_at)
         VALUES ('cl-dead', 'user-a', 'play-style', 'Dead evidence', 'active', ?, ?)`
      )
      .bind(NOW, NOW)
      .run()
    await db
      .prepare(
        `INSERT INTO profile_claim_evidence (profile_claim_id, episode_id, created_at)
         VALUES ('cl-dead', 'ep-dead', ?)`
      )
      .bind(NOW)
      .run()

    const context = await resolveCompanionContext(db, 'user-a')
    expect(context?.claims).toEqual([])
  })

  it('respects the policy budgets and dedupes recent vs salient episodes', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    // Five episodes: ep-5 newest ... ep-1 oldest; ep-1 is high-salience.
    for (let i = 1; i <= 5; i += 1) {
      await seedEpisode(db, `ep-${i}`, 'user-a', `2026-06-0${i}T10:00:00.000Z`, i === 1 ? 95 : 30)
    }
    const context = await resolveCompanionContext(db, 'user-a', undefined, {
      maxClaims: 5,
      recentEpisodes: 2,
      salientEpisodes: 1,
      minSalience: 70,
    })
    expect(context?.episodes.map((e) => e.title)).toEqual([
      'Title ep-5',
      'Title ep-4',
      'Title ep-1',
    ])
  })

  it("does not leak another user's memories", async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    await seedCompanion(db, 'user-b')
    await seedEpisode(db, 'ep-b', 'user-b', NOW)
    const context = await resolveCompanionContext(db, 'user-a')
    expect(context?.episodes).toEqual([])
  })
})

describe('resolveInjectionPolicy', () => {
  it('returns the global default for an unknown game', () => {
    expect(resolveInjectionPolicy('bombsquad')).toEqual(resolveInjectionPolicy())
  })
})

describe('resolveInjectionPolicyForStreak (B9b — memory budget scales with streak)', () => {
  it('is byte-identical to the base policy for a newcomer / no streak', () => {
    expect(resolveInjectionPolicyForStreak(undefined, 0)).toEqual(DEFAULT_INJECTION_POLICY)
    expect(resolveInjectionPolicyForStreak(undefined, 6)).toEqual(DEFAULT_INJECTION_POLICY)
  })

  it('adds recency depth + claim count at the familiar and close tiers', () => {
    expect(resolveInjectionPolicyForStreak(undefined, 7)).toEqual({
      ...DEFAULT_INJECTION_POLICY,
      maxClaims: DEFAULT_INJECTION_POLICY.maxClaims + 1,
      recentEpisodes: DEFAULT_INJECTION_POLICY.recentEpisodes + 1,
    })
    expect(resolveInjectionPolicyForStreak(undefined, 30)).toEqual({
      ...DEFAULT_INJECTION_POLICY,
      maxClaims: DEFAULT_INJECTION_POLICY.maxClaims + 2,
      recentEpisodes: DEFAULT_INJECTION_POLICY.recentEpisodes + 2,
    })
  })

  it('leaves the salience floor and high-salience slot untouched', () => {
    const close = resolveInjectionPolicyForStreak(undefined, 60)
    expect(close.salientEpisodes).toBe(DEFAULT_INJECTION_POLICY.salientEpisodes)
    expect(close.minSalience).toBe(DEFAULT_INJECTION_POLICY.minSalience)
  })
})

describe('resolveCompanionContext — streak familiarity (B9)', () => {
  it('attaches no familiarity for a newcomer or a session with no streak', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    expect((await resolveCompanionContext(db, 'user-a'))?.familiarity).toBeUndefined()
    expect(
      (await resolveCompanionContext(db, 'user-a', undefined, undefined, 6))?.familiarity
    ).toBeUndefined()
  })

  it('attaches the tier + streak once the relationship reaches the first tier', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    expect(
      (await resolveCompanionContext(db, 'user-a', undefined, undefined, 7))?.familiarity
    ).toEqual({ streakDays: 7, tier: 'familiar' })
    expect(
      (await resolveCompanionContext(db, 'user-a', undefined, undefined, 45))?.familiarity
    ).toEqual({ streakDays: 45, tier: 'close' })
  })

  it('scales the injected recent-episode budget with the streak tier', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a', false) // profile off → episodes only
    // Four episodes, newest first ep-4..ep-1 (all low salience).
    for (let i = 1; i <= 4; i += 1) {
      await seedEpisode(db, `ep-${i}`, 'user-a', `2026-06-0${i}T10:00:00.000Z`, 10)
    }
    // Newcomer: base recentEpisodes (3).
    const newcomer = await resolveCompanionContext(db, 'user-a', undefined, undefined, 0)
    expect(newcomer?.episodes).toHaveLength(DEFAULT_INJECTION_POLICY.recentEpisodes)
    // Familiar: +1 recent episode injected (the memory reaches deeper).
    const familiar = await resolveCompanionContext(db, 'user-a', undefined, undefined, 7)
    expect(familiar?.episodes).toHaveLength(DEFAULT_INJECTION_POLICY.recentEpisodes + 1)
  })
})
