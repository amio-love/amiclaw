import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_EVENT_ID_PATTERN,
  communityEventId,
  encodeCommunityCursor,
  isAfterCommunityCursor,
  parseCommunityCursor,
  synthesizeCommunityFeed,
  type CommunityActivityDay,
  type CommunityPlayerActivity,
} from './community'
import { bombsquadRunSourceKey, oracleSignSourceKey } from './source-key'

const TODAY = '2026-07-08'

/** A daily-defused day (carries the 通关 duration signal). */
function defuseDay(date: string, durationMs = 60_000): CommunityActivityDay {
  const runId = `run-${date}`
  return {
    date,
    at: `${date}T08:00:00.000Z`,
    anchor_source_key: bombsquadRunSourceKey(runId),
    duration_ms: durationMs,
  }
}

/** An oracle-sign-only day (no defusal → no 通关 signal). */
function signDay(date: string): CommunityActivityDay {
  return {
    date,
    at: `${date}T09:00:00.000Z`,
    anchor_source_key: oracleSignSourceKey(date, `sess-${date}`),
    duration_ms: null,
  }
}

function player(public_label: string, days: CommunityActivityDay[]): CommunityPlayerActivity {
  return { public_label, days }
}

describe('communityEventId', () => {
  it('is deterministic, opaque, and shape-conformant', () => {
    const key = bombsquadRunSourceKey('run-1')
    const id = communityEventId(key)
    expect(id).toBe(communityEventId(key))
    expect(COMMUNITY_EVENT_ID_PATTERN.test(id)).toBe(true)
    // Never leaks the raw source_key / run_id.
    expect(id).not.toContain('run-1')
    expect(id).not.toContain('bombsquad')
  })

  it('separates distinct anchors', () => {
    expect(communityEventId(bombsquadRunSourceKey('run-1'))).not.toBe(
      communityEventId(bombsquadRunSourceKey('run-2'))
    )
  })
})

describe('community pagination cursor', () => {
  const item = { at: '2026-07-08T08:00:00.000Z', id: 'e0123456789abcdef' }

  it('round-trips (at, id)', () => {
    expect(parseCommunityCursor(encodeCommunityCursor(item))).toEqual(item)
  })

  it('rejects a malformed cursor', () => {
    expect(parseCommunityCursor('not-a-cursor')).toBeNull()
    expect(parseCommunityCursor('2026-07-08T08:00:00.000Z~not-an-id')).toBeNull()
    expect(parseCommunityCursor('bad-date~e0123456789abcdef')).toBeNull()
  })

  it('orders strictly after the cursor by (at DESC, id ASC)', () => {
    const cursor = { at: item.at, id: 'e0000000000000ff' }
    // Earlier `at` → after.
    expect(isAfterCommunityCursor({ at: '2026-07-07T08:00:00.000Z', id: 'e0' }, cursor)).toBe(true)
    // Same `at`, larger id → after; smaller/equal id → not after.
    expect(isAfterCommunityCursor({ at: item.at, id: 'e0000000000000ff0' }, cursor)).toBe(true)
    expect(isAfterCommunityCursor({ at: item.at, id: 'e0000000000000fe' }, cursor)).toBe(false)
    expect(isAfterCommunityCursor({ at: item.at, id: cursor.id }, cursor)).toBe(false)
  })
})

describe('synthesizeCommunityFeed', () => {
  it('is empty when nobody has public activity (honest quiet state)', () => {
    expect(synthesizeCommunityFeed({ players: [], today: TODAY })).toEqual([])
  })

  it("labels a brand-new player's first defusal as 上榜 (entered the board)", () => {
    const items = synthesizeCommunityFeed({
      players: [player('Nova', [defuseDay('2026-07-08')])],
      today: TODAY,
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ template: 'leaderboard_entry', public_label: 'Nova' })
    expect(items[0].duration_ms).toBeUndefined()
  })

  it('labels defusals within an existing streak as 通关, and the streak start as 上榜', () => {
    // Current streak 07-06..07-08 (start 07-06) + an isolated older defusal.
    const items = synthesizeCommunityFeed({
      players: [
        player('Nova', [
          defuseDay('2026-06-25', 72_000),
          defuseDay('2026-07-06', 61_000),
          defuseDay('2026-07-07', 58_000),
          defuseDay('2026-07-08', 55_000),
        ]),
      ],
      today: TODAY,
    })
    const byDate = new Map(items.map((i) => [i.at.slice(0, 10), i]))
    expect(byDate.get('2026-06-25')).toMatchObject({ template: 'daily_clear', duration_ms: 72_000 })
    expect(byDate.get('2026-07-06')).toMatchObject({ template: 'leaderboard_entry' })
    expect(byDate.get('2026-07-07')).toMatchObject({ template: 'daily_clear', duration_ms: 58_000 })
    expect(byDate.get('2026-07-08')).toMatchObject({ template: 'daily_clear', duration_ms: 55_000 })
  })

  it('surfaces a 7-day streak as a milestone card, collapsing that day to ONE event', () => {
    const days = [
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
    ].map((d) => defuseDay(d))
    const items = synthesizeCommunityFeed({ players: [player('Atlas', days)], today: TODAY })

    const todayItems = items.filter((i) => i.at.slice(0, 10) === '2026-07-08')
    expect(todayItems).toHaveLength(1)
    expect(todayItems[0]).toMatchObject({ template: 'streak_milestone', streak_days: 7 })
    // The start day is 上榜; the middle days are 通关.
    expect(items.find((i) => i.at.slice(0, 10) === '2026-07-02')).toMatchObject({
      template: 'leaderboard_entry',
    })
    expect(items.filter((i) => i.template === 'daily_clear')).toHaveLength(5)
  })

  it('emits NO card for an oracle-only day that is neither a start nor a milestone', () => {
    // Old isolated oracle sign + a current run streak that starts later.
    const items = synthesizeCommunityFeed({
      players: [
        player('Sage', [signDay('2026-07-03'), defuseDay('2026-07-07'), defuseDay('2026-07-08')]),
      ],
      today: TODAY,
    })
    // 07-03 sign is isolated (not current-streak-start, not milestone) → dropped.
    expect(items.some((i) => i.at.slice(0, 10) === '2026-07-03')).toBe(false)
    expect(items.find((i) => i.at.slice(0, 10) === '2026-07-07')).toMatchObject({
      template: 'leaderboard_entry',
    })
  })

  it('excludes events older than the recent window', () => {
    const items = synthesizeCommunityFeed({
      players: [player('Old', [defuseDay('2026-06-01'), defuseDay('2026-07-08')])],
      today: TODAY,
    })
    expect(items).toHaveLength(1)
    expect(items[0].at.slice(0, 10)).toBe('2026-07-08')
  })

  it('returns items newest-first across players', () => {
    const items = synthesizeCommunityFeed({
      players: [
        player('Early', [defuseDay('2026-07-04'), defuseDay('2026-07-05')]),
        player('Late', [defuseDay('2026-07-07'), defuseDay('2026-07-08')]),
      ],
      today: TODAY,
    })
    const times = items.map((i) => i.at)
    expect(times).toEqual([...times].sort((a, b) => b.localeCompare(a)))
    expect(items[0].public_label).toBe('Late')
  })

  it('never carries a private identity field into an item', () => {
    const items = synthesizeCommunityFeed({
      players: [player('Nova', [defuseDay('2026-07-08')])],
      today: TODAY,
    })
    const serialized = JSON.stringify(items)
    expect(serialized).not.toContain('user_id')
    expect(serialized).not.toContain('source_key')
    expect(serialized).not.toContain('run-')
  })
})
