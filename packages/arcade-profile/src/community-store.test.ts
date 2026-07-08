import { describe, expect, it } from 'vitest'
import {
  likeArcadeCommunityEvent,
  readArcadeCommunityFeed,
  unlikeArcadeCommunityEvent,
  upsertArcadeProfileEvents,
  upsertArcadePublicProfile,
} from './store'
import { createTestDb } from './test-support/sqlite-db'
import type { ArcadeProfileDb } from './db'
import type { ArcadeProfileEvent } from './types'

const TODAY = '2026-07-08'
const DEPS = { now: () => '2026-07-08T10:00:00.000Z', today: () => TODAY }

function runEvent(runId: string, finishedAt: string, durationMs = 60_000): ArcadeProfileEvent {
  return {
    kind: 'bombsquad_run',
    run: {
      source_key: `bombsquad:${runId}`,
      run_id: runId,
      mode: 'daily',
      outcome: 'defused',
      duration_ms: durationMs,
      attempt_number: 1,
      module_count: 4,
      completed_modules: 4,
      strike_count: 0,
      finished_at: finishedAt,
    },
  }
}

async function seedClaimedPlayer(
  db: ArcadeProfileDb,
  userId: string,
  publicLabel: string,
  events: ArcadeProfileEvent[]
): Promise<void> {
  await upsertArcadeProfileEvents(db, userId, events, { deps: DEPS })
  await upsertArcadePublicProfile(db, userId, {
    profileId: `profile-${userId}`,
    publicLabel,
    deps: DEPS,
  })
}

describe('community feed store', () => {
  it('derives feed items only from claimed public profiles', async () => {
    const db = createTestDb()
    await seedClaimedPlayer(db, 'user-public', 'Nova', [
      runEvent('run-public', '2026-07-08T08:00:00.000Z'),
    ])
    // An unclaimed player has the same activity but no public profile.
    await upsertArcadeProfileEvents(
      db,
      'user-private',
      [runEvent('run-private', '2026-07-08T07:00:00.000Z')],
      { deps: DEPS }
    )

    const feed = await readArcadeCommunityFeed(db, { today: TODAY })

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      template: 'leaderboard_entry',
      public_label: 'Nova',
      like_count: 0,
      liked: false,
    })
  })

  it('never serializes a private identity field', async () => {
    const db = createTestDb()
    await seedClaimedPlayer(db, 'user-secret', 'Atlas', [
      runEvent('run-secret', '2026-07-08T08:00:00.000Z'),
    ])

    const feed = await readArcadeCommunityFeed(db, { today: TODAY })
    const serialized = JSON.stringify(feed)

    expect(feed.items).toHaveLength(1)
    expect(serialized).not.toContain('user-secret')
    expect(serialized).not.toContain('profile-user-secret')
    expect(serialized).not.toContain('run-secret')
    expect(serialized).not.toContain('bombsquad:run-secret')
    expect(serialized).not.toContain('user_id')
    expect(serialized).not.toContain('profile_id')
    expect(serialized).not.toContain('source_key')
  })

  it('likes idempotently and reflects the count + viewer-liked flag in the feed', async () => {
    const db = createTestDb()
    await seedClaimedPlayer(db, 'author', 'Nova', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    const before = await readArcadeCommunityFeed(db, { today: TODAY })
    const eventId = before.items[0].id

    const first = await likeArcadeCommunityEvent(db, 'liker-1', eventId, DEPS)
    const replay = await likeArcadeCommunityEvent(db, 'liker-1', eventId, DEPS)
    const second = await likeArcadeCommunityEvent(db, 'liker-2', eventId, DEPS)

    expect(first).toEqual({ event_id: eventId, like_count: 1, liked: true })
    expect(replay.like_count).toBe(1) // same user re-like is a no-op
    expect(second.like_count).toBe(2)

    // Viewer sees their own like marked; another viewer / anon does not.
    const likerView = await readArcadeCommunityFeed(db, { today: TODAY, viewerUserId: 'liker-1' })
    const anonView = await readArcadeCommunityFeed(db, { today: TODAY })
    expect(likerView.items[0]).toMatchObject({ like_count: 2, liked: true })
    expect(anonView.items[0]).toMatchObject({ like_count: 2, liked: false })
  })

  it('unlikes idempotently', async () => {
    const db = createTestDb()
    await seedClaimedPlayer(db, 'author', 'Nova', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    const feed = await readArcadeCommunityFeed(db, { today: TODAY })
    const eventId = feed.items[0].id

    await likeArcadeCommunityEvent(db, 'liker-1', eventId, DEPS)
    const removed = await unlikeArcadeCommunityEvent(db, 'liker-1', eventId)
    const removedAgain = await unlikeArcadeCommunityEvent(db, 'liker-1', eventId)

    expect(removed).toEqual({ event_id: eventId, like_count: 0, liked: false })
    expect(removedAgain.like_count).toBe(0)
  })

  it('paginates with a before cursor', async () => {
    const db = createTestDb()
    // A player with a broken streak yields several dated cards in the window.
    await seedClaimedPlayer(db, 'author', 'Nova', [
      runEvent('run-a', '2026-07-04T08:00:00.000Z'),
      runEvent('run-b', '2026-07-06T08:00:00.000Z'),
      runEvent('run-c', '2026-07-08T08:00:00.000Z'),
    ])

    const firstPage = await readArcadeCommunityFeed(db, { today: TODAY, limit: 2 })
    expect(firstPage.items).toHaveLength(2)
    // The cursor carries (at, id), not bare at.
    const last = firstPage.items[1]
    expect(firstPage.next_before).toBe(`${last.at}~${last.id}`)

    const secondPage = await readArcadeCommunityFeed(db, {
      today: TODAY,
      limit: 2,
      before: firstPage.next_before ?? undefined,
    })
    expect(secondPage.items.length).toBeGreaterThanOrEqual(1)
    expect(secondPage.next_before).toBeNull()
    // No overlap across pages.
    const firstIds = new Set(firstPage.items.map((i) => i.id))
    expect(secondPage.items.every((i) => !firstIds.has(i.id))).toBe(true)
  })

  it('does not drop same-millisecond events across a page boundary', async () => {
    const db = createTestDb()
    // Two players defuse at the exact same finished_at → two feed items sharing
    // one `at`, separated only by their id tie-breaker.
    const at = '2026-07-08T08:00:00.000Z'
    await seedClaimedPlayer(db, 'user-a', 'Ava', [runEvent('run-a', at)])
    await seedClaimedPlayer(db, 'user-b', 'Bex', [runEvent('run-b', at)])

    const firstPage = await readArcadeCommunityFeed(db, { today: TODAY, limit: 1 })
    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.next_before).not.toBeNull()

    const secondPage = await readArcadeCommunityFeed(db, {
      today: TODAY,
      limit: 1,
      before: firstPage.next_before ?? undefined,
    })

    // Both same-`at` items surface across the two pages — none is dropped.
    const seen = new Set([...firstPage.items, ...secondPage.items].map((i) => i.id))
    expect(seen.size).toBe(2)
    expect(firstPage.items[0].id).not.toBe(secondPage.items[0]?.id)
  })
})
