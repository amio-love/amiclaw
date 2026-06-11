/**
 * Control-plane store tests: setup 1:1, memory pagination + delete cascade,
 * claim correction / hard delete semantics, profile switch.
 */

import { describe, expect, it } from 'vitest'
import type { CompanionDb } from './db'
import type { DomainDeps } from './deps'
import {
  correctClaim,
  createCompanion,
  deleteAllClaims,
  deleteClaim,
  deleteMemory,
  getCompanion,
  listActiveClaimsWithEvidence,
  listMemories,
  setProfileEnabled,
} from './store'
import { createTestDb } from './test-support/sqlite-db'
import type { ProfileClaimRecord } from './types'

const NOW = '2026-06-11T10:00:00.000Z'

function testDeps(): DomainDeps {
  let n = 0
  return { now: () => NOW, newId: () => `id-${(n += 1)}` }
}

async function seedEpisode(
  db: CompanionDb,
  id: string,
  userId: string,
  occurredAt: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO episode (id, user_id, occurred_at, game_id, title, narrative, source_kind, source_ref, source_key, created_at)
       VALUES (?, ?, ?, 'bombsquad', ?, 'Narrative.', 'settlement', 'evt', ?, ?)`
    )
    .bind(id, userId, occurredAt, `Title ${id}`, `key-${id}`, NOW)
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

describe('createCompanion', () => {
  it('creates once and returns null on the second attempt (1:1)', async () => {
    const db = createTestDb()
    const deps = testDeps()
    const created = await createCompanion(
      db,
      { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' },
      deps
    )
    expect(created).toMatchObject({ user_id: 'user-a', name: 'Ami', profile_enabled: 1 })
    const second = await createCompanion(
      db,
      { userId: 'user-a', name: 'Other', voiceId: 'companion-calm' },
      deps
    )
    expect(second).toBeNull()
    expect((await getCompanion(db, 'user-a'))?.name).toBe('Ami')
  })
})

describe('listMemories', () => {
  it('paginates newest-first with a working keyset cursor', async () => {
    const db = createTestDb()
    await createCompanion(
      db,
      { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' },
      testDeps()
    )
    for (let i = 1; i <= 5; i += 1) {
      await seedEpisode(db, `ep-${i}`, 'user-a', `2026-06-0${i}T10:00:00.000Z`)
    }
    const page1 = await listMemories(db, 'user-a', { limit: 2 })
    expect(page1.memories.map((m) => m.id)).toEqual(['ep-5', 'ep-4'])
    expect(page1.nextCursor).toBeDefined()

    const page2 = await listMemories(db, 'user-a', { limit: 2, cursor: page1.nextCursor })
    expect(page2.memories.map((m) => m.id)).toEqual(['ep-3', 'ep-2'])

    const page3 = await listMemories(db, 'user-a', { limit: 2, cursor: page2.nextCursor })
    expect(page3.memories.map((m) => m.id)).toEqual(['ep-1'])
    expect(page3.nextCursor).toBeUndefined()
  })

  it('treats a malformed cursor as the first page', async () => {
    const db = createTestDb()
    await createCompanion(
      db,
      { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' },
      testDeps()
    )
    await seedEpisode(db, 'ep-1', 'user-a', NOW)
    const page = await listMemories(db, 'user-a', { cursor: '!!not-a-cursor!!' })
    expect(page.memories).toHaveLength(1)
  })
})

describe('deleteMemory', () => {
  it('soft-deletes an owned episode and cascades claim invalidation', async () => {
    const db = createTestDb()
    await createCompanion(
      db,
      { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' },
      testDeps()
    )
    await seedEpisode(db, 'ep-1', 'user-a', NOW)
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')

    expect(await deleteMemory(db, 'user-a', 'ep-1')).toBe(true)
    expect((await listMemories(db, 'user-a')).memories).toEqual([])
    expect(await listActiveClaimsWithEvidence(db, 'user-a')).toEqual([])
    // Idempotent / ownership-safe: already deleted -> false; wrong owner -> false.
    expect(await deleteMemory(db, 'user-a', 'ep-1')).toBe(false)
    expect(await deleteMemory(db, 'user-b', 'ep-1')).toBe(false)
  })
})

describe('claim control plane', () => {
  it('lists active claims with their evidence chains', async () => {
    const db = createTestDb()
    await createCompanion(
      db,
      { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' },
      testDeps()
    )
    await seedEpisode(db, 'ep-1', 'user-a', NOW)
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')
    const claims = await listActiveClaimsWithEvidence(db, 'user-a')
    expect(claims).toHaveLength(1)
    expect(claims[0].evidence).toEqual([
      { episode_id: 'ep-1', title: 'Title ep-1', occurred_at: NOW, game_id: 'bombsquad' },
    ])
  })

  it('correction turns the original to corrected and keeps the fix as a new claim with inherited evidence', async () => {
    const db = createTestDb()
    const deps = testDeps()
    await createCompanion(db, { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' }, deps)
    await seedEpisode(db, 'ep-1', 'user-a', NOW)
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')

    const corrected = await correctClaim(
      db,
      'user-a',
      'cl-1',
      'Actually thrives under pressure',
      deps
    )
    expect(corrected).toMatchObject({
      claim: 'Actually thrives under pressure',
      status: 'active',
    })
    expect(corrected?.evidence.map((e) => e.episode_id)).toEqual(['ep-1'])

    const original = await db
      .prepare(`SELECT * FROM profile_claim WHERE id = 'cl-1'`)
      .bind()
      .first<ProfileClaimRecord>()
    expect(original?.status).toBe('corrected')

    // Only the correction is active now.
    const active = await listActiveClaimsWithEvidence(db, 'user-a')
    expect(active.map((c) => c.claim)).toEqual(['Actually thrives under pressure'])

    // A second correction of the now-corrected original is rejected.
    expect(await correctClaim(db, 'user-a', 'cl-1', 'Again', deps)).toBeNull()
    // A foreign user cannot correct it either.
    expect(await correctClaim(db, 'user-b', corrected?.id ?? '', 'Hijack', deps)).toBeNull()
  })

  it('deleteAllClaims wipes every claim and stamps the deletion watermark atomically', async () => {
    const db = createTestDb()
    const deps = testDeps()
    await createCompanion(db, { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' }, deps)
    expect((await getCompanion(db, 'user-a'))?.profile_deleted_at).toBeNull()
    await seedEpisode(db, 'ep-1', 'user-a', NOW)
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')

    expect(await deleteAllClaims(db, 'user-a', deps)).toBe(1)
    expect(await listActiveClaimsWithEvidence(db, 'user-a')).toEqual([])
    expect((await getCompanion(db, 'user-a'))?.profile_deleted_at).toBe(NOW)
  })

  it('deleteClaim hard-deletes the row and its evidence links', async () => {
    const db = createTestDb()
    await createCompanion(
      db,
      { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' },
      testDeps()
    )
    await seedEpisode(db, 'ep-1', 'user-a', NOW)
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')

    expect(await deleteClaim(db, 'user-b', 'cl-1')).toBe(false)
    expect(await deleteClaim(db, 'user-a', 'cl-1')).toBe(true)
    expect(await listActiveClaimsWithEvidence(db, 'user-a')).toEqual([])
    const { results } = await db.prepare('SELECT * FROM profile_claim_evidence').bind().all()
    expect(results).toEqual([])
  })
})

describe('setProfileEnabled', () => {
  it('flips the switch and reports a missing companion', async () => {
    const db = createTestDb()
    await createCompanion(
      db,
      { userId: 'user-a', name: 'Ami', voiceId: 'companion-warm' },
      testDeps()
    )
    expect(await setProfileEnabled(db, 'user-a', false)).toBe(true)
    expect((await getCompanion(db, 'user-a'))?.profile_enabled).toBe(0)
    expect(await setProfileEnabled(db, 'nobody', false)).toBe(false)
  })
})
