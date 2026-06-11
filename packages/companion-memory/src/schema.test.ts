/**
 * Schema-invariant tests, run against the REAL migration SQL on real SQLite
 * (node:sqlite). These pin the L2 structural invariants:
 *  - one companion per account (user_id PK),
 *  - same-user cross-table constraint on evidence rows (trigger),
 *  - episode delete cascades: claims with zero remaining active evidence
 *    leave 'active',
 *  - memory rows require a companion (FK).
 */

import { describe, expect, it } from 'vitest'
import { createTestDb } from './test-support/sqlite-db'
import type { CompanionDb } from './db'
import type { ProfileClaimRecord } from './types'

const NOW = '2026-06-11T10:00:00.000Z'

async function seedCompanion(db: CompanionDb, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO companion (user_id, name, address_style, voice_id, profile_enabled, created_at)
       VALUES (?, 'Ami', '', 'companion-warm', 1, ?)`
    )
    .bind(userId, NOW)
    .run()
}

async function seedEpisode(db: CompanionDb, id: string, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO episode (id, user_id, occurred_at, game_id, title, narrative, source_kind, source_ref, source_key, created_at)
       VALUES (?, ?, ?, 'bombsquad', 'First clear', 'We did it.', 'settlement', 'evt', ?, ?)`
    )
    .bind(id, userId, NOW, `key-${id}`, NOW)
    .run()
}

async function seedClaim(db: CompanionDb, id: string, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profile_claim (id, user_id, dimension, claim, status, created_at, updated_at)
       VALUES (?, ?, 'play-style', 'Stays calm under pressure', 'active', ?, ?)`
    )
    .bind(id, userId, NOW, NOW)
    .run()
}

async function linkEvidence(db: CompanionDb, claimId: string, episodeId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profile_claim_evidence (profile_claim_id, episode_id, created_at) VALUES (?, ?, ?)`
    )
    .bind(claimId, episodeId, NOW)
    .run()
}

async function claimStatus(db: CompanionDb, claimId: string): Promise<string | undefined> {
  const row = await db
    .prepare('SELECT status FROM profile_claim WHERE id = ?')
    .bind(claimId)
    .first<ProfileClaimRecord>()
  return row?.status
}

describe('companion 1:1 invariant', () => {
  it('rejects a second companion row for the same user_id', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    await expect(seedCompanion(db, 'user-a')).rejects.toThrow()
  })
})

describe('memory rows require a companion (FK)', () => {
  it('rejects an episode for a user with no companion', async () => {
    const db = createTestDb()
    await expect(seedEpisode(db, 'ep-1', 'nobody')).rejects.toThrow()
  })
})

describe('same-user cross-table constraint (trigger)', () => {
  it('rejects evidence linking a claim and an episode owned by different users', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    await seedCompanion(db, 'user-b')
    await seedEpisode(db, 'ep-a', 'user-a')
    await seedClaim(db, 'cl-b', 'user-b')
    await expect(linkEvidence(db, 'cl-b', 'ep-a')).rejects.toThrow(/same user/)
  })

  it('accepts evidence when both ends share the user', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    await seedEpisode(db, 'ep-a', 'user-a')
    await seedClaim(db, 'cl-a', 'user-a')
    await expect(linkEvidence(db, 'cl-a', 'ep-a')).resolves.toBeUndefined()
  })
})

describe('episode delete cascade (trigger)', () => {
  it('invalidates a claim whose only active evidence episode is deleted', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    await seedEpisode(db, 'ep-1', 'user-a')
    await seedClaim(db, 'cl-1', 'user-a')
    await linkEvidence(db, 'cl-1', 'ep-1')

    await db.prepare(`UPDATE episode SET status = 'deleted' WHERE id = 'ep-1'`).bind().run()

    expect(await claimStatus(db, 'cl-1')).toBe('deleted')
  })

  it('keeps a claim active while another active evidence episode remains', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    await seedEpisode(db, 'ep-1', 'user-a')
    await seedEpisode(db, 'ep-2', 'user-a')
    await seedClaim(db, 'cl-1', 'user-a')
    await linkEvidence(db, 'cl-1', 'ep-1')
    await linkEvidence(db, 'cl-1', 'ep-2')

    await db.prepare(`UPDATE episode SET status = 'deleted' WHERE id = 'ep-1'`).bind().run()
    expect(await claimStatus(db, 'cl-1')).toBe('active')

    // Deleting the LAST active evidence now invalidates the claim.
    await db.prepare(`UPDATE episode SET status = 'deleted' WHERE id = 'ep-2'`).bind().run()
    expect(await claimStatus(db, 'cl-1')).toBe('deleted')
  })

  it('does not touch other users or unrelated claims', async () => {
    const db = createTestDb()
    await seedCompanion(db, 'user-a')
    await seedEpisode(db, 'ep-1', 'user-a')
    await seedEpisode(db, 'ep-2', 'user-a')
    await seedClaim(db, 'cl-1', 'user-a')
    await seedClaim(db, 'cl-2', 'user-a')
    await linkEvidence(db, 'cl-1', 'ep-1')
    await linkEvidence(db, 'cl-2', 'ep-2')

    await db.prepare(`UPDATE episode SET status = 'deleted' WHERE id = 'ep-1'`).bind().run()

    expect(await claimStatus(db, 'cl-1')).toBe('deleted')
    expect(await claimStatus(db, 'cl-2')).toBe('active')
  })
})

describe('ledger source_key uniqueness', () => {
  it('silently no-ops a duplicate asset credit (ON CONFLICT DO NOTHING)', async () => {
    const db = createTestDb()
    const insert = (id: string) =>
      db
        .prepare(
          `INSERT INTO asset_entry (id, user_id, asset_type, amount, source_product, source_ref, source_key, earned_at)
           VALUES (?, 'user-a', 'spark', 10, 'amiclaw', 'evt-1', 'evt-1#asset#0', ?)
           ON CONFLICT (source_key) DO NOTHING`
        )
        .bind(id, NOW)
        .run()

    const first = await insert('asset-1')
    const replay = await insert('asset-2')
    expect(first.meta.changes).toBe(1)
    expect(replay.meta.changes).toBe(0)

    const { results } = await db
      .prepare(`SELECT id FROM asset_entry WHERE user_id = 'user-a'`)
      .bind()
      .all<{ id: string }>()
    expect(results).toHaveLength(1)
  })
})
