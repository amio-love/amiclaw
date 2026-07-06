import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../../arcade-profile/src/test-support/sqlite-db'
import { FakeKV } from '../auth/fake-kv'
import {
  handleGetArcadeProfile,
  handlePostArcadeProfileClaim,
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

async function env(): Promise<ArcadeProfileApiEnv> {
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
    COMPANION_DB: createTestDb(),
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

describe('arcade profile handlers', () => {
  it('requires a session for account profile reads', async () => {
    const response = await handleGetArcadeProfile(request(undefined, ''), await env())

    expect(response.status).toBe(401)
  })

  it('claims bounded local events into the signed-in account idempotently', async () => {
    const testEnv = await env()

    const first = await handlePostArcadeProfileClaim(request(CLAIM_BODY), testEnv)
    const replay = await handlePostArcadeProfileClaim(request(CLAIM_BODY), testEnv)
    const profile = await handleGetArcadeProfile(request(), testEnv)

    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ inserted: 1, source_keys: ['bombsquad:run-1'] })
    expect(await replay.json()).toMatchObject({ inserted: 0, source_keys: ['bombsquad:run-1'] })
    expect(await profile.json()).toMatchObject({
      profile: {
        counts: { bombsquad_runs: 1, oracle_signs: 0 },
        bombsquad: { best_daily: { run_id: 'run-1' } },
      },
    })
  })
})
