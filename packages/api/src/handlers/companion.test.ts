/**
 * HTTP-semantics tests for the /api/companion/* handler family, run against
 * the REAL schema (node:sqlite test adapter from @amiclaw/companion-memory)
 * and the FakeKV session store.
 *
 * Pinned here (acceptance criteria):
 *  - every endpoint rejects an unauthenticated request with 401;
 *  - a request-body `user_id` never becomes the owner (session identity wins);
 *  - the four profile operations' semantics;
 *  - memory pagination + delete cascade visibility.
 */

import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../../companion-memory/src/test-support/sqlite-db'
import type { CompanionDb } from '../../../companion-memory/src/db'
import { FakeKV } from '../auth/fake-kv'
import { handleCompanionSetup } from './companion-setup'
import {
  handleDeleteProfile,
  handleGetProfile,
  handlePutProfileSettings,
} from './companion-profile'
import { handleClaimCorrection, handleClaimDelete } from './companion-profile-claim'
import { handleGetMemories, handleMemoryDelete } from './companion-memories'
import type { CompanionApiEnv } from './companion-shared'

const NOW = '2026-06-11T10:00:00.000Z'

async function makeEnv(): Promise<{ env: CompanionApiEnv; db: CompanionDb }> {
  const kv = new FakeKV()
  await kv.put(
    'session:sess-a',
    JSON.stringify({ user_id: 'user-a', email: 'a@example.com', created_at: NOW })
  )
  const db = createTestDb()
  return { env: { AUTH: kv.asKV(), COMPANION_DB: db }, db }
}

function authedRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://claw.amio.fans${path}`, {
    ...init,
    headers: { Cookie: 'amiclaw_session=sess-a', ...(init.headers ?? {}) },
  })
}

function anonRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://claw.amio.fans${path}`, init)
}

async function setupCompanion(env: CompanionApiEnv): Promise<Response> {
  return handleCompanionSetup(
    authedRequest('/api/companion/setup', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ami', voice_id: 'companion-warm', address_style: 'captain' }),
    }),
    env
  )
}

async function seedEpisode(
  db: CompanionDb,
  id: string,
  userId: string,
  occurredAt = NOW
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

describe('require-session gate (every endpoint, unauthenticated -> 401)', () => {
  it('rejects all companion endpoints without a valid session', async () => {
    const { env } = await makeEnv()
    const responses = await Promise.all([
      handleCompanionSetup(
        anonRequest('/api/companion/setup', { method: 'POST', body: '{}' }),
        env
      ),
      handleGetProfile(anonRequest('/api/companion/profile'), env),
      handlePutProfileSettings(
        anonRequest('/api/companion/profile', { method: 'PUT', body: '{}' }),
        env
      ),
      handleDeleteProfile(anonRequest('/api/companion/profile', { method: 'DELETE' }), env),
      handleClaimCorrection(
        anonRequest('/api/companion/profile/x/correction', { method: 'POST', body: '{}' }),
        env,
        'x'
      ),
      handleClaimDelete(anonRequest('/api/companion/profile/x', { method: 'DELETE' }), env, 'x'),
      handleGetMemories(anonRequest('/api/companion/memories'), env),
      handleMemoryDelete(anonRequest('/api/companion/memories/x', { method: 'DELETE' }), env, 'x'),
    ])
    for (const response of responses) {
      expect(response.status).toBe(401)
    }
  })
})

describe('POST /api/companion/setup', () => {
  it('creates the companion for the SESSION user, ignoring any body user_id', async () => {
    const { env, db } = await makeEnv()
    const response = await handleCompanionSetup(
      authedRequest('/api/companion/setup', {
        method: 'POST',
        // The body smuggles a foreign owner id — it must be ignored.
        body: JSON.stringify({ name: 'Ami', voice_id: 'companion-warm', user_id: 'attacker' }),
      }),
      env
    )
    expect(response.status).toBe(201)
    const owner = await db
      .prepare('SELECT user_id FROM companion')
      .bind()
      .first<{ user_id: string }>()
    expect(owner?.user_id).toBe('user-a')
  })

  it('rejects a second companion with 409 (one companion per account)', async () => {
    const { env } = await makeEnv()
    expect((await setupCompanion(env)).status).toBe(201)
    expect((await setupCompanion(env)).status).toBe(409)
  })

  it('validates name and voice_id', async () => {
    const { env } = await makeEnv()
    const badName = await handleCompanionSetup(
      authedRequest('/api/companion/setup', {
        method: 'POST',
        body: JSON.stringify({ name: '   ', voice_id: 'companion-warm' }),
      }),
      env
    )
    expect(badName.status).toBe(422)
    const badVoice = await handleCompanionSetup(
      authedRequest('/api/companion/setup', {
        method: 'POST',
        body: JSON.stringify({ name: 'Ami', voice_id: 'vendor-specific-token' }),
      }),
      env
    )
    expect(badVoice.status).toBe(422)
  })
})

describe('GET /api/companion/profile', () => {
  it('returns active claims with evidence chains', async () => {
    const { env, db } = await makeEnv()
    await setupCompanion(env)
    await seedEpisode(db, 'ep-1', 'user-a')
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')
    const response = await handleGetProfile(authedRequest('/api/companion/profile'), env)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      profile_enabled: boolean
      claims: Array<{ id: string; evidence: Array<{ episode_id: string }> }>
    }
    expect(body.profile_enabled).toBe(true)
    expect(body.claims).toHaveLength(1)
    expect(body.claims[0].evidence.map((e) => e.episode_id)).toEqual(['ep-1'])
  })

  it('404s before setup', async () => {
    const { env } = await makeEnv()
    expect((await handleGetProfile(authedRequest('/api/companion/profile'), env)).status).toBe(404)
  })
})

describe('PUT /api/companion/profile (the switch)', () => {
  it('flips profile_enabled off', async () => {
    const { env, db } = await makeEnv()
    await setupCompanion(env)
    const response = await handlePutProfileSettings(
      authedRequest('/api/companion/profile', {
        method: 'PUT',
        body: JSON.stringify({ profile_enabled: false }),
      }),
      env
    )
    expect(response.status).toBe(200)
    const row = await db
      .prepare('SELECT profile_enabled FROM companion')
      .bind()
      .first<{ profile_enabled: number }>()
    expect(row?.profile_enabled).toBe(0)
  })

  it('422s a non-boolean payload', async () => {
    const { env } = await makeEnv()
    await setupCompanion(env)
    const response = await handlePutProfileSettings(
      authedRequest('/api/companion/profile', {
        method: 'PUT',
        body: JSON.stringify({ profile_enabled: 'off' }),
      }),
      env
    )
    expect(response.status).toBe(422)
  })
})

describe('POST /api/companion/profile/<id>/correction', () => {
  it('marks the original corrected and returns the new claim', async () => {
    const { env, db } = await makeEnv()
    await setupCompanion(env)
    await seedEpisode(db, 'ep-1', 'user-a')
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')
    const response = await handleClaimCorrection(
      authedRequest('/api/companion/profile/cl-1/correction', {
        method: 'POST',
        body: JSON.stringify({ correction: 'Actually loves the keypad' }),
      }),
      env,
      'cl-1'
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      corrected_claim_id: string
      new_claim: { claim: string; evidence: Array<{ episode_id: string }> }
    }
    expect(body.corrected_claim_id).toBe('cl-1')
    expect(body.new_claim.claim).toBe('Actually loves the keypad')
    expect(body.new_claim.evidence.map((e) => e.episode_id)).toEqual(['ep-1'])
  })

  it('404s a claim owned by someone else', async () => {
    const { env, db } = await makeEnv()
    await setupCompanion(env)
    await db
      .prepare(
        `INSERT INTO companion (user_id, name, address_style, voice_id, profile_enabled, created_at)
         VALUES ('user-b', 'Bee', '', 'companion-calm', 1, ?)`
      )
      .bind(NOW)
      .run()
    await seedEpisode(db, 'ep-b', 'user-b')
    await seedClaimWithEvidence(db, 'cl-b', 'user-b', 'ep-b')
    const response = await handleClaimCorrection(
      authedRequest('/api/companion/profile/cl-b/correction', {
        method: 'POST',
        body: JSON.stringify({ correction: 'Hijack attempt' }),
      }),
      env,
      'cl-b'
    )
    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/companion/profile/<id>', () => {
  it('hard-deletes an owned claim and 404s a foreign one', async () => {
    const { env, db } = await makeEnv()
    await setupCompanion(env)
    await seedEpisode(db, 'ep-1', 'user-a')
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')
    const ok = await handleClaimDelete(
      authedRequest('/api/companion/profile/cl-1', { method: 'DELETE' }),
      env,
      'cl-1'
    )
    expect(ok.status).toBe(200)
    const remaining = await db.prepare('SELECT * FROM profile_claim').bind().all()
    expect(remaining.results).toEqual([])
    const missing = await handleClaimDelete(
      authedRequest('/api/companion/profile/cl-1', { method: 'DELETE' }),
      env,
      'cl-1'
    )
    expect(missing.status).toBe(404)
  })
})

describe('DELETE /api/companion/profile (bulk)', () => {
  it('hard-deletes every owned claim (any status) and cascades evidence; foreign claims survive', async () => {
    const { env, db } = await makeEnv()
    await setupCompanion(env)
    await seedEpisode(db, 'ep-1', 'user-a')
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-1')
    await seedClaimWithEvidence(db, 'cl-2', 'user-a', 'ep-1')
    // A corrected (non-active) claim is history — bulk delete erases it too.
    await db.prepare(`UPDATE profile_claim SET status = 'corrected' WHERE id = 'cl-2'`).bind().run()
    // Another user's claim must be untouched.
    await db
      .prepare(
        `INSERT INTO companion (user_id, name, address_style, voice_id, profile_enabled, created_at)
         VALUES ('user-b', 'Bee', '', 'companion-calm', 1, ?)`
      )
      .bind(NOW)
      .run()
    await seedEpisode(db, 'ep-b', 'user-b')
    await seedClaimWithEvidence(db, 'cl-b', 'user-b', 'ep-b')

    const response = await handleDeleteProfile(
      authedRequest('/api/companion/profile', { method: 'DELETE' }),
      env
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: 2 })

    const claims = await db.prepare('SELECT id FROM profile_claim').bind().all<{ id: string }>()
    expect(claims.results.map((c) => c.id)).toEqual(['cl-b'])
    const evidence = await db
      .prepare('SELECT profile_claim_id FROM profile_claim_evidence')
      .bind()
      .all<{ profile_claim_id: string }>()
    expect(evidence.results.map((e) => e.profile_claim_id)).toEqual(['cl-b'])
    // Visible memories are NOT the profile — episodes survive a profile wipe.
    const episodes = await db
      .prepare(`SELECT id FROM episode WHERE user_id = 'user-a'`)
      .bind()
      .all()
    expect(episodes.results).toHaveLength(1)
  })

  it('is idempotent: re-deleting an empty profile removes zero rows', async () => {
    const { env } = await makeEnv()
    await setupCompanion(env)
    const first = await handleDeleteProfile(
      authedRequest('/api/companion/profile', { method: 'DELETE' }),
      env
    )
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ deleted: 0 })
    const again = await handleDeleteProfile(
      authedRequest('/api/companion/profile', { method: 'DELETE' }),
      env
    )
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ deleted: 0 })
  })
})

describe('GET /api/companion/memories + DELETE /api/companion/memories/<id>', () => {
  it('paginates, deletes, and shows the claim cascade', async () => {
    const { env, db } = await makeEnv()
    await setupCompanion(env)
    for (let i = 1; i <= 3; i += 1) {
      await seedEpisode(db, `ep-${i}`, 'user-a', `2026-06-0${i}T10:00:00.000Z`)
    }
    await seedClaimWithEvidence(db, 'cl-1', 'user-a', 'ep-3')

    const page = await handleGetMemories(authedRequest('/api/companion/memories?limit=2'), env)
    expect(page.status).toBe(200)
    const pageBody = (await page.json()) as {
      memories: Array<{ id: string }>
      next_cursor?: string
    }
    expect(pageBody.memories.map((m) => m.id)).toEqual(['ep-3', 'ep-2'])
    expect(pageBody.next_cursor).toBeDefined()

    // Delete the newest memory — the only evidence of cl-1.
    const del = await handleMemoryDelete(
      authedRequest('/api/companion/memories/ep-3', { method: 'DELETE' }),
      env,
      'ep-3'
    )
    expect(del.status).toBe(200)

    // The album no longer shows it; the dependent claim left 'active'.
    const after = await handleGetMemories(authedRequest('/api/companion/memories'), env)
    const afterBody = (await after.json()) as { memories: Array<{ id: string }> }
    expect(afterBody.memories.map((m) => m.id)).toEqual(['ep-2', 'ep-1'])
    const profile = await handleGetProfile(authedRequest('/api/companion/profile'), env)
    const profileBody = (await profile.json()) as { claims: unknown[] }
    expect(profileBody.claims).toEqual([])
  })

  it('404s deleting a memory owned by someone else', async () => {
    const { env, db } = await makeEnv()
    await setupCompanion(env)
    await db
      .prepare(
        `INSERT INTO companion (user_id, name, address_style, voice_id, profile_enabled, created_at)
         VALUES ('user-b', 'Bee', '', 'companion-calm', 1, ?)`
      )
      .bind(NOW)
      .run()
    await seedEpisode(db, 'ep-b', 'user-b')
    const response = await handleMemoryDelete(
      authedRequest('/api/companion/memories/ep-b', { method: 'DELETE' }),
      env,
      'ep-b'
    )
    expect(response.status).toBe(404)
  })
})
