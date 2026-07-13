import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countAuthorProxyMessagesForDay,
  findInWindowCommunityEvent,
  insertProxyMessage,
  insertProxyReply,
  loadProxyMessage,
  readArcadeCommunityFeed,
  readProxyCandidateEvents,
  upsertArcadeProfileEvents,
  upsertArcadePublicProfile,
} from './store'
import { bombsquadRunSourceKey } from './source-key'
import { createProxySocialTestDb, createTestDb } from './test-support/sqlite-db'
import type { ArcadeProfileDb } from './db'
import type { ArcadeProfileEvent } from './types'

const TODAY = '2026-07-08'
const DEPS = { now: () => '2026-07-08T10:00:00.000Z', today: () => TODAY }

// A fired degrade guard emits console.warn (observability — it must never happen
// in prod). Silence it by default so suites stay quiet; the degrade tests read
// the spy to assert it fired.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

function runEvent(runId: string, finishedAt: string, durationMs = 60_000): ArcadeProfileEvent {
  return {
    kind: 'bombsquad_run',
    run: {
      source_key: bombsquadRunSourceKey(runId),
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

async function seedCompanion(db: ArcadeProfileDb, userId: string): Promise<void> {
  await db
    .prepare(`INSERT INTO companion (user_id, name, voice_id, created_at) VALUES (?, ?, ?, ?)`)
    .bind(userId, `${userId}-companion`, 'voice-default', '2026-07-01T00:00:00.000Z')
    .run()
}

const PROXY_MESSAGE = {
  messageId: 'msg-1',
  anchorSourceKey: bombsquadRunSourceKey('run-1'),
  authorUserId: 'user-jia',
  authorCompanionName: 'Nova',
  authorPublicLabel: 'Jia the Bold',
  targetUserId: 'user-yi',
  body: 'clean run!',
}

describe('proxy thread feed read', () => {
  it('embeds a full thread (message + reply) with snapshot signatures and never leaks any user_id', async () => {
    const db = createProxySocialTestDb()
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    await seedCompanion(db, 'user-yi')
    const eventId = (await readArcadeCommunityFeed(db, { today: TODAY })).items[0].id

    await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId }, DEPS)
    // Populate the reply too, so the zero-leak assertion covers a FULL thread
    // (message + reply), not just a message with reply:null.
    await insertProxyReply(
      db,
      {
        messageId: 'msg-1',
        responderCompanionName: 'Ori',
        responderPublicLabel: 'Yi',
        body: 'thank you',
      },
      DEPS
    )

    // Signed-in viewer (the owner) so viewer_is_owner is derived from a real
    // user_id server-side — which must still never be emitted.
    const feed = await readArcadeCommunityFeed(db, { today: TODAY, viewerUserId: 'user-yi' })
    expect(feed.items[0].threads).toHaveLength(1)
    expect(feed.items[0].threads[0]).toMatchObject({
      message_id: 'msg-1',
      author_companion_name: 'Nova',
      author_public_label: 'Jia the Bold',
      body: 'clean run!',
      reply: { responder_companion_name: 'Ori', responder_public_label: 'Yi', body: 'thank you' },
    })

    // Literal full-response stringify: no owner-id key OR value survives the
    // explicit field-projection boundary, even with a populated reply thread.
    const serialized = JSON.stringify(feed)
    expect(serialized).not.toContain('user-yi')
    expect(serialized).not.toContain('user-jia')
    expect(serialized).not.toContain('author_user_id')
    expect(serialized).not.toContain('target_user_id')
    expect(serialized).not.toContain('responder_user_id')
    expect(serialized).not.toContain('user_id')
    expect(serialized).not.toContain('anchor_source_key')
  })

  it('stacks multiple author threads under one event (UNIQUE is per author, not per event)', async () => {
    const db = createProxySocialTestDb()
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    const eventId = (await readArcadeCommunityFeed(db, { today: TODAY })).items[0].id

    // msg-1 is written LATER than msg-2 so ORDER BY created_at ASC (not
    // message_id / insertion order) is actually exercised: created_at wins →
    // ['msg-2', 'msg-1'], the opposite of message_id ASC.
    const first = await insertProxyMessage(
      db,
      { ...PROXY_MESSAGE, eventId },
      {
        now: () => '2026-07-08T10:00:02.000Z',
      }
    )
    const second = await insertProxyMessage(
      db,
      {
        ...PROXY_MESSAGE,
        eventId,
        messageId: 'msg-2',
        authorUserId: 'user-bob',
        authorCompanionName: 'Atlas',
        authorPublicLabel: 'Bob',
        body: 'gg',
      },
      { now: () => '2026-07-08T10:00:01.000Z' }
    )

    expect(first.inserted).toBe(true)
    expect(second.inserted).toBe(true)
    const feed = await readArcadeCommunityFeed(db, { today: TODAY })
    expect(feed.items[0].threads.map((t) => t.message_id)).toEqual(['msg-2', 'msg-1'])
  })

  it('degrades proxy threads to [] when migration 0007 is absent (mode① readable)', async () => {
    const db = createTestDb() // default: no 0007, no companion table
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])

    const anon = await readArcadeCommunityFeed(db, { today: TODAY })
    expect(anon.items).toHaveLength(1)
    expect(anon.items[0].threads).toEqual([])
    expect(anon.items[0]).toMatchObject({ viewer_is_owner: false, viewer_has_companion: false })
    // A fired guard is visible, not silent.
    expect(console.warn).toHaveBeenCalled()

    // A signed-in viewer against the same minimal DB must not 500 either: the
    // companion table is also absent, so viewer_has_companion degrades to false.
    const signedIn = await readArcadeCommunityFeed(db, { today: TODAY, viewerUserId: 'user-yi' })
    expect(signedIn.items[0].threads).toEqual([])
    expect(signedIn.items[0]).toMatchObject({ viewer_is_owner: true, viewer_has_companion: false })
  })

  it('unifies the degrade: reply table missing but messages present → threads [] (no partial state)', async () => {
    const db = createProxySocialTestDb()
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    await seedCompanion(db, 'user-yi')
    const eventId = (await readArcadeCommunityFeed(db, { today: TODAY })).items[0].id
    await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId }, DEPS)

    // Simulate the (migration-impossible) partial state: the message table is
    // present but the reply table is gone. The unified guard must still collapse
    // to [] rather than render a message with a false can_reply.
    await db.prepare('DROP TABLE arcade_community_proxy_reply').run()

    const feed = await readArcadeCommunityFeed(db, { today: TODAY, viewerUserId: 'user-yi' })
    expect(feed.items[0].threads).toEqual([])
    expect(console.warn).toHaveBeenCalled()
  })

  it('derives viewer flags and per-thread can_reply server-side', async () => {
    const db = createProxySocialTestDb()
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    const eventId = (await readArcadeCommunityFeed(db, { today: TODAY })).items[0].id
    await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId }, DEPS)

    // Anonymous: not owner, no companion, cannot reply.
    const anon = await readArcadeCommunityFeed(db, { today: TODAY })
    expect(anon.items[0]).toMatchObject({ viewer_is_owner: false, viewer_has_companion: false })
    expect(anon.items[0].threads[0].can_reply).toBe(false)

    // 乙 without a companion: owner but cannot reply → build-companion CTA state.
    const ownerNoCompanion = await readArcadeCommunityFeed(db, {
      today: TODAY,
      viewerUserId: 'user-yi',
    })
    expect(ownerNoCompanion.items[0]).toMatchObject({
      viewer_is_owner: true,
      viewer_has_companion: false,
    })
    expect(ownerNoCompanion.items[0].threads[0].can_reply).toBe(false)

    // 乙 with a companion: can reply.
    await seedCompanion(db, 'user-yi')
    const ownerWithCompanion = await readArcadeCommunityFeed(db, {
      today: TODAY,
      viewerUserId: 'user-yi',
    })
    expect(ownerWithCompanion.items[0]).toMatchObject({
      viewer_is_owner: true,
      viewer_has_companion: true,
    })
    expect(ownerWithCompanion.items[0].threads[0].can_reply).toBe(true)

    // 甲 (has a companion) is NOT the owner → cannot reply on 乙's event.
    await seedCompanion(db, 'user-jia')
    const authorView = await readArcadeCommunityFeed(db, { today: TODAY, viewerUserId: 'user-jia' })
    expect(authorView.items[0]).toMatchObject({
      viewer_is_owner: false,
      viewer_has_companion: true,
    })
    expect(authorView.items[0].threads[0].can_reply).toBe(false)

    // Once replied, can_reply is false even for the owner-with-companion.
    await insertProxyReply(
      db,
      {
        messageId: 'msg-1',
        responderCompanionName: 'Ori',
        responderPublicLabel: 'Yi',
        body: 'thank you',
      },
      DEPS
    )
    const replied = await readArcadeCommunityFeed(db, { today: TODAY, viewerUserId: 'user-yi' })
    expect(replied.items[0].threads[0].reply).toMatchObject({
      responder_companion_name: 'Ori',
      responder_public_label: 'Yi',
      body: 'thank you',
    })
    expect(replied.items[0].threads[0].can_reply).toBe(false)
  })
})

describe('proxy write backstops (一轮封顶 = DB constraints)', () => {
  it('maps a duplicate proxy message to inserted:false (V1 UNIQUE(event, author) backstop)', async () => {
    const db = createProxySocialTestDb()
    const eventId = 'e00000000000000a'

    const first = await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId }, DEPS)
    // Same (event_id, author_user_id), different message_id → real UNIQUE
    // violation, not the fast exists_* pre-check.
    const dup = await insertProxyMessage(
      db,
      { ...PROXY_MESSAGE, eventId, messageId: 'msg-2', body: 'again' },
      DEPS
    )

    expect(first).toEqual({ inserted: true })
    expect(dup).toEqual({ inserted: false, reason: 'duplicate' })
  })

  it('distinguishes a message_id PK collision (id-collision) from an (event, author) duplicate', async () => {
    const db = createProxySocialTestDb()
    await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId: 'e00000000000000a' }, DEPS)

    // Same message_id, DIFFERENT (event, author) → collides on the message_id
    // PRIMARY KEY, not on UNIQUE(event_id, author_user_id) → reason:'id-collision'
    // (the route regenerates the id), NOT the idempotent 'duplicate'.
    const idClash = await insertProxyMessage(
      db,
      {
        ...PROXY_MESSAGE,
        eventId: 'e00000000000000b',
        authorUserId: 'user-bob',
        authorCompanionName: 'Atlas',
        authorPublicLabel: 'Bob',
      },
      DEPS
    )
    expect(idClash).toEqual({ inserted: false, reason: 'id-collision' })
  })

  it('maps a duplicate reply to inserted:false reason:duplicate (V2 message_id PK backstop)', async () => {
    const db = createProxySocialTestDb()
    await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId: 'e00000000000000b' }, DEPS)

    const first = await insertProxyReply(
      db,
      {
        messageId: 'msg-1',
        responderCompanionName: 'Ori',
        responderPublicLabel: 'Yi',
        body: 'thanks',
      },
      DEPS
    )
    const dup = await insertProxyReply(
      db,
      {
        messageId: 'msg-1',
        responderCompanionName: 'Ori',
        responderPublicLabel: 'Yi',
        body: 'thanks again',
      },
      DEPS
    )

    expect(first).toEqual({ inserted: true })
    expect(dup).toEqual({ inserted: false, reason: 'duplicate' })
  })

  it('rejects a reply whose parent message does not exist (missing-message backstop)', async () => {
    // Defense-in-depth: even if the caller skipped its 404-on-missing step, the
    // primitive never writes an orphan reply.
    const db = createProxySocialTestDb()
    const res = await insertProxyReply(
      db,
      {
        messageId: 'ghost-message',
        responderCompanionName: 'Ori',
        responderPublicLabel: 'Yi',
        body: 'into the void',
      },
      DEPS
    )
    expect(res).toEqual({ inserted: false, reason: 'missing-message' })
    // And nothing was written.
    const count = await db
      .prepare(`SELECT COUNT(*) AS count FROM arcade_community_proxy_reply`)
      .first<{ count: number }>()
    expect(count?.count).toBe(0)
  })
})

describe('in-window anchor guard (findInWindowCommunityEvent)', () => {
  it('resolves an in-window anchor and rejects one that has aged out', async () => {
    const db = createProxySocialTestDb()
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    const eventId = (await readArcadeCommunityFeed(db, { today: TODAY })).items[0].id

    const inWindow = await findInWindowCommunityEvent(db, eventId, { today: TODAY })
    expect(inWindow?.id).toBe(eventId)
    expect(inWindow).toMatchObject({ template: 'leaderboard_entry', public_label: 'Yi' })

    // 33 days later the anchor has slid out of the 14-day window → 410 territory.
    const agedOut = await findInWindowCommunityEvent(db, eventId, { today: '2026-08-10' })
    expect(agedOut).toBeNull()
  })

  it('returns null for an anchor that was never in the feed', async () => {
    const db = createProxySocialTestDb()
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    expect(await findInWindowCommunityEvent(db, 'e00000000000dead', { today: TODAY })).toBeNull()
  })
})

describe('V1 candidate selection (readProxyCandidateEvents)', () => {
  it('enriches candidates with owner + anchor, excludes own events, sorts newest-first', async () => {
    const db = createProxySocialTestDb()
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])

    // 甲 (user-jia) may proxy on 乙's event — enriched with the private owner +
    // anchor the public feed strips.
    const jiaCandidates = await readProxyCandidateEvents(db, 'user-jia', { today: TODAY })
    expect(jiaCandidates).toHaveLength(1)
    expect(jiaCandidates[0]).toMatchObject({
      event_id: (await readArcadeCommunityFeed(db, { today: TODAY })).items[0].id,
      anchor_source_key: bombsquadRunSourceKey('run-1'),
      target_user_id: 'user-yi',
      template: 'leaderboard_entry',
      target_public_label: 'Yi',
    })

    // 乙 is the owner → their own event is never a candidate.
    expect(await readProxyCandidateEvents(db, 'user-yi', { today: TODAY })).toEqual([])
  })

  it('excludes events the author has already proxied on', async () => {
    const db = createProxySocialTestDb()
    await seedClaimedPlayer(db, 'user-yi', 'Yi', [runEvent('run-1', '2026-07-08T08:00:00.000Z')])
    const eventId = (await readArcadeCommunityFeed(db, { today: TODAY })).items[0].id

    expect(await readProxyCandidateEvents(db, 'user-jia', { today: TODAY })).toHaveLength(1)
    await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId }, DEPS)
    expect(await readProxyCandidateEvents(db, 'user-jia', { today: TODAY })).toEqual([])
  })
})

describe('V1 daily cap (countAuthorProxyMessagesForDay)', () => {
  it('counts only the author’s messages on the given UTC day', async () => {
    const db = createProxySocialTestDb()
    await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId: 'e00000000000000a' }, DEPS)
    await insertProxyMessage(
      db,
      { ...PROXY_MESSAGE, eventId: 'e00000000000000b', messageId: 'msg-2' },
      DEPS
    )
    // A different author's message is not counted.
    await insertProxyMessage(
      db,
      {
        ...PROXY_MESSAGE,
        eventId: 'e00000000000000c',
        messageId: 'msg-3',
        authorUserId: 'user-bob',
      },
      DEPS
    )

    expect(await countAuthorProxyMessagesForDay(db, 'user-jia', { day: '2026-07-08' })).toBe(2)
    expect(await countAuthorProxyMessagesForDay(db, 'user-jia', { day: '2026-07-09' })).toBe(0)
    expect(await countAuthorProxyMessagesForDay(db, 'user-bob', { day: '2026-07-08' })).toBe(1)
  })
})

describe('V2 message load (loadProxyMessage)', () => {
  it('loads the reply-auth identity, anchor, body, and reply-existence flag', async () => {
    const db = createProxySocialTestDb()
    await insertProxyMessage(db, { ...PROXY_MESSAGE, eventId: 'e00000000000000a' }, DEPS)

    const loaded = await loadProxyMessage(db, 'msg-1')
    expect(loaded).toMatchObject({
      message_id: 'msg-1',
      event_id: 'e00000000000000a',
      author_user_id: 'user-jia',
      target_user_id: 'user-yi',
      body: 'clean run!',
      has_reply: false,
    })

    await insertProxyReply(
      db,
      { messageId: 'msg-1', responderCompanionName: 'Ori', responderPublicLabel: 'Yi', body: 'ty' },
      DEPS
    )
    expect((await loadProxyMessage(db, 'msg-1'))?.has_reply).toBe(true)
  })

  it('returns null for a message that does not exist', async () => {
    const db = createProxySocialTestDb()
    expect(await loadProxyMessage(db, 'ghost')).toBeNull()
  })
})
