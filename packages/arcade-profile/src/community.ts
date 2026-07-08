import { getProductDaysEndingAt } from '../../../shared/date'
import {
  computeArcadeStreak,
  isIsoDate,
  runLengthsByDate,
  shiftDate,
  type QualifiedActivityDate,
} from './summary'
import type { ArcadeCommunityFeedItem, ArcadeCommunityFeedTemplate } from './types'

/* How many recent product days the feed synthesizes events over. Streak math
   still reads a player's FULL qualified-date history (a streak may start before
   the window); only event EMISSION is capped to this recent window. */
export const COMMUNITY_FEED_WINDOW_DAYS = 14

/* Streak lengths that surface a milestone card.
   SSOT NOTE: these thresholds must eventually come from the shared
   companion-familiarity SSOT (a parallel worktree is landing
   `shared/companion-familiarity.ts` with 7 / 14 / 30 / 60). That module is NOT
   on this branch yet, so the thresholds live here in ONE clearly-named constant;
   integration will reconcile this against the shared module. Until then this
   mirrors the PRD streak-reward thresholds (7 / 14 / 30 / 60 days). */
export const COMMUNITY_STREAK_MILESTONES: readonly number[] = [7, 14, 30, 60]

/**
 * Deterministic, opaque feed-event id derived ONLY from the anchor row's
 * source_key (a bombsquad run or oracle sign source_key). It is stable across
 * template reclassification (a run that is `daily_clear` today and turns into a
 * `streak_milestone` once more days land keeps the same id, so its likes never
 * orphan) and it never leaks the raw source_key / run_id — the board handler
 * treats run_id as a backend-only key, and the feed keeps that discipline by
 * exposing a 64-bit FNV-1a hash instead. `e` + 16 lowercase hex.
 */
export function communityEventId(anchorSourceKey: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < anchorSourceKey.length; i += 1) {
    hash ^= BigInt(anchorSourceKey.charCodeAt(i))
    hash = (hash * prime) & mask
  }
  return `e${hash.toString(16).padStart(16, '0')}`
}

/** Shape the `communityEventId` output takes — the like-key contract. */
export const COMMUNITY_EVENT_ID_PATTERN = /^e[0-9a-f]{16}$/

/* --- Pagination cursor -------------------------------------------------------
   Items are ordered (at DESC, id ASC). The cursor carries BOTH the timestamp
   and the id so same-millisecond events are never dropped at a page boundary —
   the id is the stable tie-breaker. Encoded as `<iso-at>~<event-id>`; neither
   part contains `~` (the id is `e`+hex, the at is an ISO string). */
const CURSOR_SEP = '~'

export interface CommunityCursor {
  at: string
  id: string
}

export function encodeCommunityCursor(item: Pick<ArcadeCommunityFeedItem, 'at' | 'id'>): string {
  return `${item.at}${CURSOR_SEP}${item.id}`
}

export function parseCommunityCursor(value: string): CommunityCursor | null {
  const sep = value.lastIndexOf(CURSOR_SEP)
  if (sep <= 0) return null
  const at = value.slice(0, sep)
  const id = value.slice(sep + 1)
  if (Number.isNaN(Date.parse(at))) return null
  if (!COMMUNITY_EVENT_ID_PATTERN.test(id)) return null
  return { at, id }
}

/** True when `item` sorts strictly AFTER the cursor in (at DESC, id ASC) order —
    i.e. it belongs on the NEXT page. */
export function isAfterCommunityCursor(
  item: Pick<ArcadeCommunityFeedItem, 'at' | 'id'>,
  cursor: CommunityCursor
): boolean {
  if (item.at < cursor.at) return true
  return item.at === cursor.at && item.id > cursor.id
}

/* One qualified product day for a public-profile player. `duration_ms` is set
   only when the day carries a daily-defused run (the 通关 signal); an
   oracle-sign-only day carries `null`. `anchor_source_key` is the durable row
   the event id is minted from; `at` is that row's ISO timestamp. */
export interface CommunityActivityDay {
  date: string
  at: string
  anchor_source_key: string
  duration_ms: number | null
}

export interface CommunityPlayerActivity {
  public_label: string
  /** One entry per qualified product day, any order (sorted internally). */
  days: CommunityActivityDay[]
}

function makeItem(
  template: ArcadeCommunityFeedTemplate,
  player: CommunityPlayerActivity,
  day: CommunityActivityDay,
  extra: { duration_ms?: number; streak_days?: number }
): ArcadeCommunityFeedItem {
  return {
    id: communityEventId(day.anchor_source_key),
    template,
    public_label: player.public_label,
    at: day.at,
    ...(extra.duration_ms !== undefined ? { duration_ms: extra.duration_ms } : {}),
    ...(extra.streak_days !== undefined ? { streak_days: extra.streak_days } : {}),
    like_count: 0,
    liked: false,
  }
}

/**
 * Synthesize the community feed from per-player durable activity — the honest
 * event stream, no synthetic events, no padding.
 *
 * Per player, each qualified product day collapses to AT MOST ONE card by
 * signal priority (so one real moment is never inflated into multiple cards):
 *
 *   streak_milestone  (consecutive length ∈ COMMUNITY_STREAK_MILESTONES) — top
 *   > leaderboard_entry (the FIRST day of the player's current streak run —
 *     the day they (re)entered the streak board)
 *   > daily_clear      (any remaining day that carried a daily defusal)
 *
 * An oracle-sign-only day that is neither a milestone nor a streak-start emits
 * NOTHING — the three approved templates do not include a bare oracle sign, and
 * inventing one would be padding.
 *
 * The streak definition is NOT re-implemented here: per-date consecutive lengths
 * come from summary's `runLengthsByDate`, and the current-run start is derived
 * from `computeArcadeStreak` — the same single source the streak leaderboard and
 * the /me streak use, so the feed and the board can never disagree.
 *
 * Events are emitted only for days inside the recent window and returned newest
 * first (at DESC, id ASC). `like_count` / `liked` are placeholders (0 / false) —
 * the store layer attaches real like state per page.
 */
export function synthesizeCommunityFeed(input: {
  players: CommunityPlayerActivity[]
  today: string
  windowDays?: number
}): ArcadeCommunityFeedItem[] {
  const windowDays = input.windowDays ?? COMMUNITY_FEED_WINDOW_DAYS
  const windowSet = new Set(getProductDaysEndingAt(input.today, windowDays))
  const items: ArcadeCommunityFeedItem[] = []

  for (const player of input.players) {
    const days = player.days.filter((day) => isIsoDate(day.date) && day.date <= input.today)
    if (days.length === 0) continue

    const qualifiedDates: QualifiedActivityDate[] = days.map((day) => ({
      date: day.date,
      completed_at: day.at,
    }))
    // Per-date consecutive-run length (milestone classification) + the current
    // streak's start day (上榜) — both from summary, the single streak source.
    const lengthByDate = runLengthsByDate(qualifiedDates, input.today)
    const streak = computeArcadeStreak(qualifiedDates, input.today)
    const currentStreakStart =
      streak.current_days > 0 && streak.last_active_date
        ? shiftDate(streak.last_active_date, -(streak.current_days - 1))
        : null

    for (const day of days) {
      if (!windowSet.has(day.date)) continue
      const length = lengthByDate.get(day.date) ?? 1
      if (COMMUNITY_STREAK_MILESTONES.includes(length)) {
        items.push(makeItem('streak_milestone', player, day, { streak_days: length }))
      } else if (day.date === currentStreakStart) {
        items.push(makeItem('leaderboard_entry', player, day, {}))
      } else if (day.duration_ms !== null) {
        items.push(makeItem('daily_clear', player, day, { duration_ms: day.duration_ms }))
      }
      // else: oracle-only, non-milestone, non-start → no card (honest quiet).
    }
  }

  return items.sort((a, b) => {
    const byTime = b.at.localeCompare(a.at)
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
  })
}
