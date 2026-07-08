import { getTodayString } from '../../../shared/date'
import type { ArcadeProfileDb } from './db'
import {
  encodeCommunityCursor,
  isAfterCommunityCursor,
  parseCommunityCursor,
  synthesizeCommunityFeed,
  type CommunityActivityDay,
  type CommunityPlayerActivity,
} from './community'
import { computeArcadeStreak, summarizeArcadeProfile, type QualifiedActivityDate } from './summary'
import type {
  ArcadeCommunityFeedResponse,
  ArcadeCommunityLikeResponse,
  ArcadeProfileEvent,
  ArcadeProfileSummary,
  ArcadePublicProfileStatus,
  ArcadeStreakLeaderboardEntry,
  ArcadeStreakLeaderboardResponse,
  BombSquadProfileRun,
  OracleProfileSign,
} from './types'

export type { ArcadeProfileDb } from './db'
// Re-export the cursor parser so the API handler validates `?before=` against
// the same (at, id) cursor contract the store paginates on.
export { parseCommunityCursor } from './community'

interface BombSquadRunRow {
  source_key: string
  profile_id: string | null
  run_id: string
  mode: BombSquadProfileRun['mode']
  outcome: BombSquadProfileRun['outcome']
  duration_ms: number
  attempt_number: number
  module_count: number
  completed_modules: number
  strike_count: number
  finished_at: string
}

interface OracleSignRow {
  source_key: string
  profile_id: string | null
  session_id: string
  sign_date: string
  ben: string
  bian: string
  yao_values: string
  created_at: string
}

interface CountRow {
  count: number
}

interface QualifiedDateRow {
  activity_date: string
  completed_at: string
}

interface PublicProfileRow {
  public_label: string
}

interface PublicQualifiedActivityRow {
  user_id: string
  public_label: string
  activity_date: string
  completed_at: string
  activity_kind: 'bombsquad' | 'oracle'
}

export interface StoreDeps {
  now?: () => string
  today?: () => string
}

function eventSourceKey(event: ArcadeProfileEvent): string {
  return event.kind === 'bombsquad_run' ? event.run.source_key : event.sign.source_key
}

function eventProfileId(event: ArcadeProfileEvent, fallback?: string): string | null {
  return event.profile_id ?? fallback ?? null
}

function isMissingPublicProfileTableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('arcade_public_profile')
}

function isMissingCommunityLikeTableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('arcade_community_like')
}

interface CommunityRunRow {
  user_id: string
  public_label: string
  source_key: string
  duration_ms: number
  finished_at: string
}

interface CommunitySignRow {
  user_id: string
  public_label: string
  source_key: string
  sign_date: string
  created_at: string
}

interface CommunityLikeCountRow {
  event_id: string
  count: number
}

interface CommunityLikeEventRow {
  event_id: string
}

const COMMUNITY_FEED_DEFAULT_LIMIT = 30
const COMMUNITY_FEED_MAX_LIMIT = 50
/** Defensive cap on the detailed row pull — beta scale is tiny; at real scale
    the feed should move to incremental windowing + streak state. */
const COMMUNITY_ROW_SCAN_LIMIT = 5000

async function readAccountQualifiedDates(
  db: ArcadeProfileDb,
  userId: string
): Promise<{
  bombsquad: QualifiedActivityDate[]
  oracle: QualifiedActivityDate[]
}> {
  const { results: bombsquadRows } = await db
    .prepare(
      `SELECT substr(finished_at, 1, 10) AS activity_date, MAX(finished_at) AS completed_at
       FROM arcade_profile_bombsquad_run
       WHERE user_id = ? AND mode = 'daily' AND outcome = 'defused'
       GROUP BY activity_date`
    )
    .bind(userId)
    .all<QualifiedDateRow>()

  const { results: oracleRows } = await db
    .prepare(
      `SELECT sign_date AS activity_date, MAX(created_at) AS completed_at
       FROM arcade_profile_oracle_sign
       WHERE user_id = ? AND substr(created_at, 1, 10) = sign_date
       GROUP BY sign_date`
    )
    .bind(userId)
    .all<QualifiedDateRow>()

  return {
    bombsquad: bombsquadRows.map((row) => ({
      date: row.activity_date,
      completed_at: row.completed_at,
    })),
    oracle: oracleRows.map((row) => ({
      date: row.activity_date,
      completed_at: row.completed_at,
    })),
  }
}

export async function upsertArcadeProfileEvents(
  db: ArcadeProfileDb,
  userId: string,
  events: ArcadeProfileEvent[],
  options: { profileId?: string; deps?: StoreDeps } = {}
): Promise<{ inserted: number; sourceKeys: string[] }> {
  const now = options.deps?.now ?? (() => new Date().toISOString())
  let inserted = 0
  const sourceKeys: string[] = []

  for (const event of events) {
    sourceKeys.push(eventSourceKey(event))
    if (event.kind === 'bombsquad_run') {
      const run = event.run
      const result = await db
        .prepare(
          `INSERT INTO arcade_profile_bombsquad_run (
             user_id, source_key, profile_id, run_id, mode, outcome, duration_ms,
             attempt_number, module_count, completed_modules, strike_count,
             finished_at, created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, source_key) DO NOTHING`
        )
        .bind(
          userId,
          run.source_key,
          eventProfileId(event, options.profileId),
          run.run_id,
          run.mode,
          run.outcome,
          run.duration_ms,
          run.attempt_number,
          run.module_count,
          run.completed_modules,
          run.strike_count,
          run.finished_at,
          now()
        )
        .run()
      inserted += result.meta.changes
    } else {
      const sign = event.sign
      const result = await db
        .prepare(
          `INSERT INTO arcade_profile_oracle_sign (
             user_id, source_key, profile_id, session_id, sign_date, ben, bian,
             yao_values, created_at, inserted_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, source_key) DO NOTHING`
        )
        .bind(
          userId,
          sign.source_key,
          eventProfileId(event, options.profileId),
          sign.session_id,
          sign.sign_date,
          sign.ben,
          sign.bian,
          JSON.stringify(sign.yao_values),
          sign.created_at,
          now()
        )
        .run()
      inserted += result.meta.changes
    }
  }

  return { inserted, sourceKeys }
}

export async function upsertArcadePublicProfile(
  db: ArcadeProfileDb,
  userId: string,
  input: {
    profileId: string
    publicLabel: string
    deps?: StoreDeps
  }
): Promise<ArcadePublicProfileStatus> {
  const now = input.deps?.now ?? (() => new Date().toISOString())
  const timestamp = now()
  await db
    .prepare(
      `INSERT INTO arcade_public_profile (
         user_id, profile_id, public_label, claimed_at, label_updated_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         profile_id = excluded.profile_id,
         public_label = excluded.public_label,
         label_updated_at = excluded.label_updated_at,
         updated_at = excluded.updated_at`
    )
    .bind(userId, input.profileId, input.publicLabel, timestamp, timestamp, timestamp)
    .run()

  return { claimed: true, public_label: input.publicLabel }
}

export async function readArcadePublicProfile(
  db: ArcadeProfileDb,
  userId: string
): Promise<ArcadePublicProfileStatus> {
  let row: PublicProfileRow | null
  try {
    row = await db
      .prepare(`SELECT public_label FROM arcade_public_profile WHERE user_id = ? LIMIT 1`)
      .bind(userId)
      .first<PublicProfileRow>()
  } catch (error) {
    if (!isMissingPublicProfileTableError(error)) throw error
    return { claimed: false, public_label: null }
  }
  if (!row) return { claimed: false, public_label: null }
  return { claimed: true, public_label: row.public_label }
}

export async function readArcadeAccountProfile(
  db: ArcadeProfileDb,
  userId: string,
  deps: StoreDeps = {}
): Promise<ArcadeProfileSummary> {
  const { results: runRows } = await db
    .prepare(
      `SELECT source_key, profile_id, run_id, mode, outcome, duration_ms,
              attempt_number, module_count, completed_modules, strike_count, finished_at
       FROM arcade_profile_bombsquad_run
       WHERE user_id = ?
       ORDER BY finished_at DESC, source_key DESC
       LIMIT 100`
    )
    .bind(userId)
    .all<BombSquadRunRow>()

  const { results: signRows } = await db
    .prepare(
      `SELECT source_key, profile_id, session_id, sign_date, ben, bian, yao_values, created_at
       FROM arcade_profile_oracle_sign
       WHERE user_id = ?
       ORDER BY created_at DESC, source_key DESC
       LIMIT 100`
    )
    .bind(userId)
    .all<OracleSignRow>()

  const [bombsquadCount, oracleCount, qualifiedDates] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS count FROM arcade_profile_bombsquad_run WHERE user_id = ?`)
      .bind(userId)
      .first<CountRow>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM arcade_profile_oracle_sign WHERE user_id = ?`)
      .bind(userId)
      .first<CountRow>(),
    readAccountQualifiedDates(db, userId),
  ])

  const bombsquadRuns: BombSquadProfileRun[] = runRows.map((row) => ({
    source_key: row.source_key,
    run_id: row.run_id,
    mode: row.mode,
    outcome: row.outcome,
    duration_ms: row.duration_ms,
    attempt_number: row.attempt_number,
    module_count: row.module_count,
    completed_modules: row.completed_modules,
    strike_count: row.strike_count,
    finished_at: row.finished_at,
  }))
  const oracleSigns: OracleProfileSign[] = signRows.map((row) => ({
    source_key: row.source_key,
    session_id: row.session_id,
    sign_date: row.sign_date,
    ben: row.ben,
    bian: row.bian,
    yao_values: JSON.parse(row.yao_values) as OracleProfileSign['yao_values'],
    created_at: row.created_at,
  }))

  return summarizeArcadeProfile({
    profileId:
      runRows.find((row) => row.profile_id !== null)?.profile_id ??
      signRows.find((row) => row.profile_id !== null)?.profile_id ??
      undefined,
    bombsquadRuns,
    oracleSigns,
    today: deps.today?.() ?? getTodayString(),
    counts: {
      bombsquad_runs: bombsquadCount?.count ?? bombsquadRuns.length,
      oracle_signs: oracleCount?.count ?? oracleSigns.length,
    },
    qualifiedBombSquadDates: qualifiedDates.bombsquad,
    qualifiedOracleDates: qualifiedDates.oracle,
  })
}

export async function readArcadeStreakLeaderboard(
  db: ArcadeProfileDb,
  options: {
    date?: string
    limit?: number
  } = {}
): Promise<ArcadeStreakLeaderboardResponse> {
  const date = options.date ?? getTodayString()
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100)
  const { results } = await db
    .prepare(
      `SELECT p.user_id, p.public_label, substr(b.finished_at, 1, 10) AS activity_date,
              MAX(b.finished_at) AS completed_at, 'bombsquad' AS activity_kind
       FROM arcade_public_profile p
       JOIN arcade_profile_bombsquad_run b ON b.user_id = p.user_id
       WHERE b.mode = 'daily' AND b.outcome = 'defused' AND substr(b.finished_at, 1, 10) <= ?
       GROUP BY p.user_id, p.public_label, activity_date
       UNION ALL
       SELECT p.user_id, p.public_label, o.sign_date AS activity_date,
              MAX(o.created_at) AS completed_at, 'oracle' AS activity_kind
       FROM arcade_public_profile p
       JOIN arcade_profile_oracle_sign o ON o.user_id = p.user_id
       WHERE o.sign_date <= ? AND substr(o.created_at, 1, 10) = o.sign_date
       GROUP BY p.user_id, p.public_label, activity_date`
    )
    .bind(date, date)
    .all<PublicQualifiedActivityRow>()

  const grouped = new Map<
    string,
    {
      publicLabel: string
      bombsquad: QualifiedActivityDate[]
      oracle: QualifiedActivityDate[]
    }
  >()

  for (const row of results) {
    const entry = grouped.get(row.user_id) ?? {
      publicLabel: row.public_label,
      bombsquad: [],
      oracle: [],
    }
    const activity = { date: row.activity_date, completed_at: row.completed_at }
    if (row.activity_kind === 'bombsquad') {
      entry.bombsquad.push(activity)
    } else {
      entry.oracle.push(activity)
    }
    grouped.set(row.user_id, entry)
  }

  const entries: Omit<ArcadeStreakLeaderboardEntry, 'rank'>[] = []
  for (const entry of grouped.values()) {
    const streak = computeArcadeStreak([...entry.bombsquad, ...entry.oracle], date)
    if (!streak.last_active_date || streak.current_days === 0) continue
    entries.push({
      public_label: entry.publicLabel,
      current_streak_days: streak.current_days,
      longest_streak_days: streak.longest_days,
      last_active_date: streak.last_active_date,
      today: {
        bombsquad_defused: entry.bombsquad.some((item) => item.date === date),
        oracle_signed: entry.oracle.some((item) => item.date === date),
      },
    })
  }

  return {
    date,
    entries: entries
      .sort((a, b) => {
        const byCurrent = b.current_streak_days - a.current_streak_days
        if (byCurrent !== 0) return byCurrent
        const byLongest = b.longest_streak_days - a.longest_streak_days
        if (byLongest !== 0) return byLongest
        const byRecent = b.last_active_date.localeCompare(a.last_active_date)
        if (byRecent !== 0) return byRecent
        return a.public_label.localeCompare(b.public_label)
      })
      .slice(0, limit)
      .map((entry, index) => ({ rank: index + 1, ...entry })),
  }
}

/* Gather the durable public-profile activity the community feed derives from —
   daily defusals and same-day oracle signs of players who claimed a public
   profile. Only the public_label ever leaves this layer; user_id / profile_id
   / source_key never reach the wire. */
async function readCommunityPlayerActivity(
  db: ArcadeProfileDb,
  today: string
): Promise<CommunityPlayerActivity[]> {
  let runRows: CommunityRunRow[]
  let signRows: CommunitySignRow[]
  try {
    const runs = await db
      .prepare(
        `SELECT p.user_id AS user_id, p.public_label AS public_label, b.source_key AS source_key,
                b.duration_ms AS duration_ms, b.finished_at AS finished_at
         FROM arcade_public_profile p
         JOIN arcade_profile_bombsquad_run b ON b.user_id = p.user_id
         WHERE b.mode = 'daily' AND b.outcome = 'defused' AND substr(b.finished_at, 1, 10) <= ?
         ORDER BY b.finished_at DESC
         LIMIT ${COMMUNITY_ROW_SCAN_LIMIT}`
      )
      .bind(today)
      .all<CommunityRunRow>()
    const signs = await db
      .prepare(
        `SELECT p.user_id AS user_id, p.public_label AS public_label, o.source_key AS source_key,
                o.sign_date AS sign_date, o.created_at AS created_at
         FROM arcade_public_profile p
         JOIN arcade_profile_oracle_sign o ON o.user_id = p.user_id
         WHERE o.sign_date <= ? AND substr(o.created_at, 1, 10) = o.sign_date
         ORDER BY o.created_at DESC
         LIMIT ${COMMUNITY_ROW_SCAN_LIMIT}`
      )
      .bind(today)
      .all<CommunitySignRow>()
    runRows = runs.results
    signRows = signs.results
  } catch (error) {
    // Public-profile table absent (pre-0003) → no public activity, honest empty.
    if (!isMissingPublicProfileTableError(error)) throw error
    return []
  }

  const byUser = new Map<
    string,
    { public_label: string; days: Map<string, CommunityActivityDay> }
  >()

  for (const row of runRows) {
    const date = row.finished_at.slice(0, 10)
    const entry = byUser.get(row.user_id) ?? { public_label: row.public_label, days: new Map() }
    const existing = entry.days.get(date)
    // Anchor a daily-defusal day on the day's FASTEST run (stable best_daily).
    if (
      existing === undefined ||
      existing.duration_ms === null ||
      row.duration_ms < existing.duration_ms
    ) {
      entry.days.set(date, {
        date,
        at: row.finished_at,
        anchor_source_key: row.source_key,
        duration_ms: row.duration_ms,
      })
    }
    byUser.set(row.user_id, entry)
  }

  for (const row of signRows) {
    const date = row.sign_date
    const entry = byUser.get(row.user_id) ?? { public_label: row.public_label, days: new Map() }
    const existing = entry.days.get(date)
    // A day already anchored on a defusal keeps that anchor (it carries the
    // 通关 signal); an oracle-only day anchors on its latest sign.
    if (existing === undefined) {
      entry.days.set(date, {
        date,
        at: row.created_at,
        anchor_source_key: row.source_key,
        duration_ms: null,
      })
    } else if (existing.duration_ms === null && row.created_at > existing.at) {
      entry.days.set(date, {
        date,
        at: row.created_at,
        anchor_source_key: row.source_key,
        duration_ms: null,
      })
    }
    byUser.set(row.user_id, entry)
  }

  return [...byUser.values()].map((entry) => ({
    public_label: entry.public_label,
    days: [...entry.days.values()],
  }))
}

async function communityLikeCount(db: ArcadeProfileDb, eventId: string): Promise<number> {
  try {
    const row = await db
      .prepare(`SELECT COUNT(*) AS count FROM arcade_community_like WHERE event_id = ?`)
      .bind(eventId)
      .first<CountRow>()
    return row?.count ?? 0
  } catch (error) {
    if (!isMissingCommunityLikeTableError(error)) throw error
    return 0
  }
}

export interface CommunityFeedOptions {
  today?: string
  before?: string
  limit?: number
  /** The signed-in viewer's user_id, when present — used only to mark which
      items THEY liked; never serialized. Anonymous reads pass undefined. */
  viewerUserId?: string
}

export async function readArcadeCommunityFeed(
  db: ArcadeProfileDb,
  options: CommunityFeedOptions = {}
): Promise<ArcadeCommunityFeedResponse> {
  const today = options.today ?? getTodayString()
  const limit = Math.min(
    Math.max(options.limit ?? COMMUNITY_FEED_DEFAULT_LIMIT, 1),
    COMMUNITY_FEED_MAX_LIMIT
  )

  const players = await readCommunityPlayerActivity(db, today)
  const all = synthesizeCommunityFeed({ players, today })
  // Cursor carries (at, id) so same-millisecond events are never dropped at a
  // page boundary. A malformed cursor is treated as "from the start".
  const cursor = options.before ? parseCommunityCursor(options.before) : null
  const filtered = cursor ? all.filter((item) => isAfterCommunityCursor(item, cursor)) : all
  const page = filtered.slice(0, limit)
  const hasMore = filtered.length > limit
  const nextBefore =
    hasMore && page.length > 0 ? encodeCommunityCursor(page[page.length - 1]) : null

  const ids = page.map((item) => item.id)
  const counts = new Map<string, number>()
  const likedSet = new Set<string>()
  if (ids.length > 0) {
    try {
      const placeholders = ids.map(() => '?').join(', ')
      const { results: countRows } = await db
        .prepare(
          `SELECT event_id, COUNT(*) AS count FROM arcade_community_like
           WHERE event_id IN (${placeholders}) GROUP BY event_id`
        )
        .bind(...ids)
        .all<CommunityLikeCountRow>()
      for (const row of countRows) counts.set(row.event_id, row.count)
      if (options.viewerUserId) {
        const { results: likedRows } = await db
          .prepare(
            `SELECT event_id FROM arcade_community_like
             WHERE user_id = ? AND event_id IN (${placeholders})`
          )
          .bind(options.viewerUserId, ...ids)
          .all<CommunityLikeEventRow>()
        for (const row of likedRows) likedSet.add(row.event_id)
      }
    } catch (error) {
      // Like table absent (0005 not applied yet) → every item reads zero likes.
      if (!isMissingCommunityLikeTableError(error)) throw error
    }
  }

  return {
    items: page.map((item) => ({
      ...item,
      like_count: counts.get(item.id) ?? 0,
      liked: likedSet.has(item.id),
    })),
    next_before: nextBefore,
  }
}

export async function likeArcadeCommunityEvent(
  db: ArcadeProfileDb,
  userId: string,
  eventId: string,
  deps: StoreDeps = {}
): Promise<ArcadeCommunityLikeResponse> {
  const now = deps.now ?? (() => new Date().toISOString())
  await db
    .prepare(
      `INSERT INTO arcade_community_like (event_id, user_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (event_id, user_id) DO NOTHING`
    )
    .bind(eventId, userId, now())
    .run()
  return { event_id: eventId, like_count: await communityLikeCount(db, eventId), liked: true }
}

export async function unlikeArcadeCommunityEvent(
  db: ArcadeProfileDb,
  userId: string,
  eventId: string
): Promise<ArcadeCommunityLikeResponse> {
  await db
    .prepare(`DELETE FROM arcade_community_like WHERE event_id = ? AND user_id = ?`)
    .bind(eventId, userId)
    .run()
  return { event_id: eventId, like_count: await communityLikeCount(db, eventId), liked: false }
}
