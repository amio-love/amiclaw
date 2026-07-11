import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArcadeStreakLeaderboardResponse } from '@amiclaw/arcade-profile/types'
import { createTestDb } from '../../../arcade-profile/src/test-support/sqlite-db'
import { FakeKV } from '../auth/fake-kv'
import {
  handleGetArcadeStreakLeaderboard,
  handleGetArcadeProfile,
  handlePostArcadeProfileClaim,
  handlePostArcadeProfileEvent,
  type ArcadeProfileApiEnv,
} from './arcade-profile'

const SESSION_COOKIE = 'amiclaw_session=sess-1'

const CLAIM_BODY = {
  profile_id: 'local-profile',
  events: [
    {
      kind: 'bombsquad_run',
      run: {
        source_key: 'bombsquad:run-1',
        run_id: 'run-1',
        mode: 'daily',
        outcome: 'defused',
        duration_ms: 45_000,
        attempt_number: 1,
        module_count: 4,
        completed_modules: 4,
        strike_count: 0,
        finished_at: '2026-07-06T08:00:00.000Z',
      },
    },
  ],
}

async function env(db = createTestDb()): Promise<ArcadeProfileApiEnv> {
  const auth = new FakeKV()
  await auth.put(
    'session:sess-1',
    JSON.stringify({
      user_id: 'user-a',
      email: 'a@example.com',
      created_at: '2026-07-06T07:00:00.000Z',
    })
  )
  return {
    AUTH: auth.asKV(),
    COMPANION_DB: db,
  }
}

function request(body?: unknown, cookie = SESSION_COOKIE): Request {
  return new Request('https://claw.amio.fans/api/arcade/profile/claim', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function getRequest(url: string, cookie = SESSION_COOKIE): Request {
  return new Request(url, {
    method: 'GET',
    headers: cookie ? { Cookie: cookie } : {},
  })
}

describe('arcade profile handlers', () => {
  // The bombsquad fixture run finished on 2026-07-06; pin "today" to that day
  // (only `Date` is faked, so async D1 work is unaffected) so the account-read
  // streak assertion (current_days: 1 = active today) is date-stable instead of
  // depending on the real wall clock. The streak-board tests already fix the
  // "as of" day via `?date=2026-07-06`.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-06T08:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers 204 (not 401) for an anonymous account profile read so it makes no console noise (F27)', async () => {
    // An anonymous GET has no account to resolve; the server accepts it as a
    // no-content read rather than 401, so an anonymous player's settlement does
    // not spray a red 401 into the console. The client reads 204 as `anon`.
    const response = await handleGetArcadeProfile(request(undefined, ''), await env())

    expect(response.status).toBe(204)
  })

  it('claims bounded local events into the signed-in account idempotently', async () => {
    const testEnv = await env()

    const first = await handlePostArcadeProfileClaim(request(CLAIM_BODY), testEnv)
    const replay = await handlePostArcadeProfileClaim(request(CLAIM_BODY), testEnv)
    const profile = await handleGetArcadeProfile(request(), testEnv)

    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      inserted: 1,
      source_keys: ['bombsquad:run-1'],
      public_profile: {
        // F-C: with no client nickname, the label derives from the account
        // email local-part ('a@example.com' -> 'a'), NOT a Player XXXX
        // placeholder — a logged-in user always has a real name signal.
        claimed: true,
        public_label: 'a',
      },
    })
    expect(await replay.json()).toMatchObject({ inserted: 0, source_keys: ['bombsquad:run-1'] })
    expect(await profile.json()).toMatchObject({
      profile: {
        counts: { bombsquad_runs: 1, oracle_signs: 0 },
        bombsquad: { best_daily: { run_id: 'run-1' } },
        daily_loop: { streak: { current_days: 1 } },
      },
      public_profile: { claimed: true },
    })
  })

  it('answers 204 (not 401) for an anonymous settlement event so it makes no console noise (F27)', async () => {
    // A fire-and-forget settlement sync with no session: the server accepts it
    // as a no-op (nothing to attach to an account) rather than 401, so an
    // anonymous run does not spray red 401s into the console.
    const response = await handlePostArcadeProfileEvent(
      request(CLAIM_BODY.events[0], ''),
      await env()
    )

    expect(response.status).toBe(204)
  })

  it('does not let event writes create public streak-board eligibility', async () => {
    const testEnv = await env()

    const response = await handlePostArcadeProfileEvent(request(CLAIM_BODY.events[0]), testEnv)
    const board = await handleGetArcadeStreakLeaderboard(
      getRequest('https://claw.amio.fans/api/arcade/streaks?date=2026-07-06'),
      testEnv
    )

    expect(response.status).toBe(200)
    expect(await board.json()).toEqual({ date: '2026-07-06', entries: [] })
  })

  it('keeps account profile reads working before public-profile migration exists', async () => {
    const testEnv = await env(createTestDb({ migrations: ['0002_arcade_profile.sql'] }))

    await handlePostArcadeProfileEvent(request(CLAIM_BODY.events[0]), testEnv)
    const response = await handleGetArcadeProfile(request(), testEnv)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      profile: {
        counts: { bombsquad_runs: 1, oracle_signs: 0 },
      },
      public_profile: { claimed: false, public_label: null },
    })
  })

  it('lets an explicit empty claim enable public streak eligibility for existing account events', async () => {
    const testEnv = await env()

    await handlePostArcadeProfileEvent(request(CLAIM_BODY.events[0]), testEnv)
    const claim = await handlePostArcadeProfileClaim(
      request({ profile_id: 'local-profile', events: [] }),
      testEnv
    )
    const board = await handleGetArcadeStreakLeaderboard(
      getRequest('https://claw.amio.fans/api/arcade/streaks?date=2026-07-06'),
      testEnv
    )
    const body = (await board.json()) as ArcadeStreakLeaderboardResponse

    expect(claim.status).toBe(200)
    expect(await claim.clone().json()).toMatchObject({
      inserted: 0,
      source_keys: [],
      public_profile: { claimed: true },
    })
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].current_streak_days).toBe(1)
  })

  it('returns public streak entries without private identity fields', async () => {
    const testEnv = await env()

    // An email-shaped client label is rejected (never stored raw) and falls
    // through to the account-derived default (local-part) — the full address
    // and domain never leak onto the public board.
    await handlePostArcadeProfileClaim(
      request({ ...CLAIM_BODY, public_label: 'a@example.com' }),
      testEnv
    )
    const response = await handleGetArcadeStreakLeaderboard(
      getRequest('https://claw.amio.fans/api/arcade/streaks?date=2026-07-06&limit=10'),
      testEnv
    )
    const body = (await response.json()) as ArcadeStreakLeaderboardResponse
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].public_label).toBe('a')
    expect(serialized).not.toContain('user-a')
    expect(serialized).not.toContain('a@example.com')
    expect(serialized).not.toContain('example.com')
    expect(serialized).not.toContain('local-profile')
    expect(serialized).not.toContain('profile_id')
    expect(serialized).not.toContain('user_id')
  })

  it('surfaces the chosen nickname on the public board when the claim carries one', async () => {
    const testEnv = await env()

    // A logged-in player who supplies their chosen nickname surfaces it on the
    // streak board — never the generated placeholder (F-C).
    await handlePostArcadeProfileClaim(
      request({ ...CLAIM_BODY, public_label: '海阔天空' }),
      testEnv
    )
    const response = await handleGetArcadeStreakLeaderboard(
      getRequest('https://claw.amio.fans/api/arcade/streaks?date=2026-07-06'),
      testEnv
    )
    const body = (await response.json()) as ArcadeStreakLeaderboardResponse

    expect(response.status).toBe(200)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].public_label).toBe('海阔天空')
  })
})
