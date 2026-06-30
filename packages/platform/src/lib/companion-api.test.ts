/**
 * Companion data-access layer tests.
 *
 * Two halves:
 *   1. The real API path (seed off): each call maps HTTP status → discriminated
 *      result (exists / none / conflict / invalid / ok / error), and a network
 *      throw becomes `error` rather than propagating.
 *   2. The dev-seed path (seed on): every read returns mock data and every
 *      mutation is a local no-op success WITHOUT touching fetch (READ-ONLY).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCompanion,
  setupCompanion,
  fetchMemories,
  deleteMemory,
  fetchProfile,
  correctClaim,
  deleteClaim,
  deleteAllClaims,
  setProfileEnabled,
} from './companion-api'
import { SEED_COMPANION, SEED_MEMORIES } from './companion-seed'
import type { ProfileClaimView } from '@shared/companion-types'

const SEED_STORAGE_KEY = 'amiclaw:companionSeed'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Install a fetch mock with a single response (or implementation). */
function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

const CLAIM: ProfileClaimView = {
  id: 'cl-1',
  dimension: 'play-style',
  claim: 'Loves the dial',
  status: 'active',
  updated_at: '2026-06-11T10:00:00.000Z',
  evidence: [
    {
      episode_id: 'ep-1',
      title: 'Title',
      occurred_at: '2026-06-11T10:00:00.000Z',
      game_id: 'bombsquad',
    },
  ],
}

describe('companion-api (real path)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchCompanion maps 200 / 404 / error', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(SEED_COMPANION, 200)))
    expect(await fetchCompanion()).toEqual({ kind: 'exists', companion: SEED_COMPANION })

    stubFetch(() => Promise.resolve(jsonResponse({ error: 'no companion set up' }, 404)))
    expect(await fetchCompanion()).toEqual({ kind: 'none' })

    stubFetch(() => Promise.resolve(jsonResponse({ error: 'boom' }, 500)))
    expect(await fetchCompanion()).toEqual({ kind: 'error' })

    stubFetch(() => Promise.reject(new Error('offline')))
    expect(await fetchCompanion()).toEqual({ kind: 'error' })
  })

  it('setupCompanion maps 201 / 409 / 422 / error', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ companion: SEED_COMPANION }, 201)))
    expect(await setupCompanion({ name: 'X', voice_id: 'companion-warm' })).toEqual({
      kind: 'created',
      companion: SEED_COMPANION,
    })

    stubFetch(() => Promise.resolve(jsonResponse({ error: 'companion already exists' }, 409)))
    expect(await setupCompanion({ name: 'X', voice_id: 'companion-warm' })).toEqual({
      kind: 'conflict',
    })

    stubFetch(() => Promise.resolve(jsonResponse({ error: 'name must be 1-30 characters' }, 422)))
    expect(await setupCompanion({ name: '', voice_id: 'companion-warm' })).toEqual({
      kind: 'invalid',
      error: 'name must be 1-30 characters',
    })

    stubFetch(() => Promise.resolve(jsonResponse({}, 500)))
    expect(await setupCompanion({ name: 'X', voice_id: 'companion-warm' })).toEqual({
      kind: 'error',
    })
  })

  it('fetchMemories returns the page + cursor, and maps failure to error', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse({ memories: SEED_MEMORIES, next_cursor: 'CURSOR' }, 200))
    )
    const ok = await fetchMemories()
    expect(ok).toEqual({ kind: 'ok', memories: SEED_MEMORIES, nextCursor: 'CURSOR' })

    stubFetch(() => Promise.resolve(jsonResponse({}, 401)))
    expect(await fetchMemories()).toEqual({ kind: 'error' })
  })

  it('fetchMemories forwards the cursor as a query param', async () => {
    const fn = stubFetch(() => Promise.resolve(jsonResponse({ memories: [] }, 200)))
    await fetchMemories('NEXT')
    const url = String(fn.mock.calls[0][0])
    expect(url).toContain('/api/companion/memories?cursor=NEXT')
  })

  it('deleteMemory maps ok / error', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true }, 200)))
    expect(await deleteMemory('ep-1')).toEqual({ kind: 'ok' })

    stubFetch(() => Promise.resolve(jsonResponse({ error: 'memory not found' }, 404)))
    expect(await deleteMemory('ep-1')).toEqual({ kind: 'error' })
  })

  it('fetchProfile maps 200 / 404 / error', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ profile_enabled: false, claims: [CLAIM] }, 200)))
    expect(await fetchProfile()).toEqual({
      kind: 'ok',
      profileEnabled: false,
      claims: [CLAIM],
    })

    stubFetch(() => Promise.resolve(jsonResponse({ error: 'no companion set up' }, 404)))
    expect(await fetchProfile()).toEqual({ kind: 'none' })

    stubFetch(() => Promise.resolve(jsonResponse({}, 500)))
    expect(await fetchProfile()).toEqual({ kind: 'error' })
  })

  it('correctClaim returns the new claim on success and maps 422 to invalid', async () => {
    const newClaim = { ...CLAIM, id: 'cl-2', claim: 'Corrected' }
    stubFetch(() =>
      Promise.resolve(jsonResponse({ corrected_claim_id: 'cl-1', new_claim: newClaim }, 200))
    )
    expect(await correctClaim(CLAIM, 'Corrected')).toEqual({
      kind: 'ok',
      correctedClaimId: 'cl-1',
      newClaim,
    })

    stubFetch(() => Promise.resolve(jsonResponse({ error: 'correction must be 1-280' }, 422)))
    expect(await correctClaim(CLAIM, '')).toEqual({
      kind: 'invalid',
      error: 'correction must be 1-280',
    })
  })

  it('deleteClaim / deleteAllClaims / setProfileEnabled map their results', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true }, 200)))
    expect(await deleteClaim('cl-1')).toEqual({ kind: 'ok' })

    stubFetch(() => Promise.resolve(jsonResponse({ deleted: 3 }, 200)))
    expect(await deleteAllClaims()).toEqual({ kind: 'ok', deleted: 3 })

    stubFetch(() => Promise.resolve(jsonResponse({ profile_enabled: false }, 200)))
    expect(await setProfileEnabled(false)).toEqual({ kind: 'ok', profileEnabled: false })

    stubFetch(() => Promise.resolve(jsonResponse({}, 500)))
    expect(await setProfileEnabled(false)).toEqual({ kind: 'error' })
  })
})

describe('companion-api (dev seed)', () => {
  beforeEach(() => {
    window.sessionStorage.setItem(SEED_STORAGE_KEY, '1')
  })
  afterEach(() => {
    window.sessionStorage.removeItem(SEED_STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  it('reads return mock data without calling fetch', async () => {
    const fn = stubFetch(() => Promise.reject(new Error('fetch must not be called in seed mode')))

    expect(await fetchCompanion()).toEqual({ kind: 'exists', companion: SEED_COMPANION })
    const memories = await fetchMemories()
    expect(memories.kind).toBe('ok')
    expect(memories.kind === 'ok' && memories.memories.length).toBe(SEED_MEMORIES.length)
    const profile = await fetchProfile()
    expect(profile.kind).toBe('ok')
    expect(profile.kind === 'ok' && profile.claims.length).toBeGreaterThan(0)

    expect(fn).not.toHaveBeenCalled()
  })

  it('mutations are local no-op successes without calling fetch', async () => {
    const fn = stubFetch(() => Promise.reject(new Error('fetch must not be called in seed mode')))

    expect(await deleteMemory('seed-ep-1')).toEqual({ kind: 'ok' })
    expect(await deleteClaim('seed-claim-1')).toEqual({ kind: 'ok' })
    expect((await deleteAllClaims()).kind).toBe('ok')
    expect(await setProfileEnabled(false)).toEqual({ kind: 'ok', profileEnabled: false })

    const correction = await correctClaim(CLAIM, 'New wording')
    expect(correction.kind).toBe('ok')
    expect(correction.kind === 'ok' && correction.newClaim.claim).toBe('New wording')

    expect(fn).not.toHaveBeenCalled()
  })
})
