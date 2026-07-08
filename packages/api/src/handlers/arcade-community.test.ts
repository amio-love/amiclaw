import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { upsertArcadeProfileEvents, upsertArcadePublicProfile } from '@amiclaw/arcade-profile/store'
import type { ArcadeProfileDb } from '@amiclaw/arcade-profile/store'
import type {
  ArcadeCommunityFeedResponse,
  ArcadeCommunityLikeResponse,
  ArcadeProfileEvent,
} from '@amiclaw/arcade-profile/types'
import { createTestDb } from '../../../arcade-profile/src/test-support/sqlite-db'
import { FakeKV } from '../auth/fake-kv'
import {
  handleDeleteArcadeCommunityLike,
  handleGetArcadeCommunityFeed,
  handlePostArcadeCommunityLike,
} from './arcade-community'
import type { ArcadeProfileApiEnv } from './arcade-profile'

const SESSION_COOKIE = 'amiclaw_session=sess-1'
const FEED_URL = 'https://claw.amio.fans/api/arcade/community/feed'
const LIKES_URL = 'https://claw.amio.fans/api/arcade/community/likes'

function runEvent(runId: string, finishedAt: string): ArcadeProfileEvent {
  return {
    kind: 'bombsquad_run',
    run: {
      source_key: `bombsquad:${runId}`,
      run_id: runId,
      mode: 'daily',
      outcome: 'defused',
      duration_ms: 55_000,
      attempt_number: 1,
      module_count: 4,
      completed_modules: 4,
      strike_count: 0,
      finished_at: finishedAt,
    },
  }
}

async function env(db = createTestDb()): Promise<ArcadeProfileApiEnv> {
  const auth = new FakeKV()
  await auth.put(
    'session:sess-1',
    JSON.stringify({
      user_id: 'viewer-a',
      email: 'a@example.com',
      created_at: '2026-07-08T07:00:00.000Z',
    })
  )
  return { AUTH: auth.asKV(), COMPANION_DB: db }
}

async function seedPublicPlayer(db: ArcadeProfileDb): Promise<void> {
  await upsertArcadeProfileEvents(db, 'author-1', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
  await upsertArcadePublicProfile(db, 'author-1', {
    profileId: 'profile-1',
    publicLabel: 'Nova',
  })
}

function getReq(url: string, cookie?: string): Request {
  return new Request(url, { method: 'GET', headers: cookie ? { Cookie: cookie } : {} })
}

function likeReq(method: 'POST' | 'DELETE', body: unknown, cookie?: string): Request {
  return new Request(LIKES_URL, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('arcade community handlers', () => {
  // The seeded run finished on 2026-07-08; pin "today" to that day so the feed
  // derivation (getTodayString) is date-stable. Only Date is faked, so the async
  // D1 work is unaffected.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-08T08:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves the derived feed anonymously without private identity fields', async () => {
    const testEnv = await env()
    await seedPublicPlayer(testEnv.COMPANION_DB)

    const response = await handleGetArcadeCommunityFeed(getReq(FEED_URL), testEnv)
    const body = (await response.json()) as ArcadeCommunityFeedResponse
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ public_label: 'Nova', liked: false })
    expect(serialized).not.toContain('author-1')
    expect(serialized).not.toContain('profile-1')
    expect(serialized).not.toContain('user_id')
    expect(serialized).not.toContain('source_key')
    expect(serialized).not.toContain('run-1')
  })

  it('requires a session to like (honest login gate)', async () => {
    const testEnv = await env()
    await seedPublicPlayer(testEnv.COMPANION_DB)
    const feed = await handleGetArcadeCommunityFeed(getReq(FEED_URL), testEnv)
    const eventId = ((await feed.json()) as ArcadeCommunityFeedResponse).items[0].id

    const response = await handlePostArcadeCommunityLike(
      likeReq('POST', { event_id: eventId }),
      testEnv
    )

    expect(response.status).toBe(401)
  })

  it('likes idempotently for a signed-in viewer and marks it in the feed', async () => {
    const testEnv = await env()
    await seedPublicPlayer(testEnv.COMPANION_DB)
    const feed = await handleGetArcadeCommunityFeed(getReq(FEED_URL), testEnv)
    const eventId = ((await feed.json()) as ArcadeCommunityFeedResponse).items[0].id

    const first = await handlePostArcadeCommunityLike(
      likeReq('POST', { event_id: eventId }, SESSION_COOKIE),
      testEnv
    )
    const replay = await handlePostArcadeCommunityLike(
      likeReq('POST', { event_id: eventId }, SESSION_COOKIE),
      testEnv
    )
    const viewerFeed = await handleGetArcadeCommunityFeed(getReq(FEED_URL, SESSION_COOKIE), testEnv)

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ event_id: eventId, like_count: 1, liked: true })
    expect(((await replay.json()) as ArcadeCommunityLikeResponse).like_count).toBe(1)
    expect(((await viewerFeed.json()) as ArcadeCommunityFeedResponse).items[0]).toMatchObject({
      like_count: 1,
      liked: true,
    })
  })

  it('unlikes for a signed-in viewer', async () => {
    const testEnv = await env()
    await seedPublicPlayer(testEnv.COMPANION_DB)
    const feed = await handleGetArcadeCommunityFeed(getReq(FEED_URL), testEnv)
    const eventId = ((await feed.json()) as ArcadeCommunityFeedResponse).items[0].id

    await handlePostArcadeCommunityLike(
      likeReq('POST', { event_id: eventId }, SESSION_COOKIE),
      testEnv
    )
    const removed = await handleDeleteArcadeCommunityLike(
      likeReq('DELETE', { event_id: eventId }, SESSION_COOKIE),
      testEnv
    )

    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ event_id: eventId, like_count: 0, liked: false })
  })

  it('rejects a malformed event id', async () => {
    const testEnv = await env()
    const response = await handlePostArcadeCommunityLike(
      likeReq('POST', { event_id: 'not-a-real-id' }, SESSION_COOKIE),
      testEnv
    )
    expect(response.status).toBe(422)
  })

  it('rejects an out-of-range limit', async () => {
    const testEnv = await env()
    const response = await handleGetArcadeCommunityFeed(getReq(`${FEED_URL}?limit=999`), testEnv)
    expect(response.status).toBe(422)
  })
})
