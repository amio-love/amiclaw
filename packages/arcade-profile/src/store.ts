import { getTodayString } from '../../../shared/date'
import type { ArcadeProfileDb } from './db'
import {
  communityEventId,
  encodeCommunityCursor,
  isAfterCommunityCursor,
  parseCommunityCursor,
  synthesizeCommunityFeed,
  type CommunityActivityDay,
  type CommunityPlayerActivity,
} from './community'
import { computeArcadeStreak, summarizeArcadeProfile, type QualifiedActivityDate } from './summary'
import type {
  ArcadeCommunityFeedItem,
  ArcadeCommunityFeedResponse,
  ArcadeCommunityFeedTemplate,
  ArcadeCommunityLikeResponse,
  ArcadeCommunityProxyReply,
  ArcadeCommunityProxyThread,
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

/* Proxy-social tables land in migration 0007. If the migration lags the Worker
   deploy, the feed's thread read must degrade to empty threads[] rather than
   fail the whole (mode① anonymous-readable) feed — mirrors the like-table guard.
   Both proxy tables share the `arcade_community_proxy` prefix, so one predicate
   covers a missing message OR reply table. */
function isMissingProxyTableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('arcade_community_proxy')
}

/* The companion table is migration 0001, always present in production. This
   guard only keeps the feed read total in minimal test databases (and any
   pathological ordering) so a signed-in viewer never turns the feed into a 500;
   a missing table just reads viewer_has_companion = false. */
function isMissingCompanionTableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('no such table') &&
    error.message.includes('companion')
  )
}

/* SQLite / D1 surface a UNIQUE or PRIMARY KEY collision as "UNIQUE constraint
   failed: ..." — the DB-level backstop for 一轮封顶. The insert paths catch it
   and map it to a structural `inserted: false` (V1 idempotent messaged:false /
   V2 already-replied) instead of leaking a 500. */
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

/* Which uniqueness key a proxy-MESSAGE INSERT collided on, keyed on the column(s)
   SQLite/D1 name in "UNIQUE constraint failed: <table>.<col>[, ...]". The message
   table has TWO uniqueness keys, so the two collisions mean different things:
     - `id-collision` — the `message_id` PRIMARY KEY clashed (a freshly-minted id
       already exists); distinct from a real duplicate, so the V1 route regenerates
       the id and retries once rather than treating it as "already proxied";
     - `duplicate`    — the `UNIQUE(event_id, author_user_id)` clashed (this author
       companion already proxied this event → V1 idempotent messaged:false).
   Returns null when the error is not a UNIQUE collision. */
function proxyMessageCollisionReason(error: unknown): 'id-collision' | 'duplicate' | null {
  if (!isUniqueConstraintError(error)) return null
  return /message_id/i.test((error as Error).message) ? 'id-collision' : 'duplicate'
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

  return [...byUser.entries()].map(([userId, entry]) => ({
    // Owner identity is carried for server-side `viewer_is_owner` derivation
    // only — `synthesizeCommunityFeed` reads public_label / days and never
    // copies user_id into an item, so it never reaches the wire.
    user_id: userId,
    public_label: entry.public_label,
    days: [...entry.days.values()],
  }))
}

/* Map each in-window event id -> its owner user_id + durable anchor key, derived
   from the same player activity the feed was synthesized from. Both the public
   feed read (owner -> viewer_is_owner) and the proxy-candidate read (owner +
   anchor for the write-time snapshot) consume this identical derivation; neither
   re-derives it inline. Players carrying no user_id (never expected for derived
   activity) are skipped. Server-only — the owner user_id never reaches the wire. */
function buildOwnerEnrichByEvent(
  players: CommunityPlayerActivity[]
): Map<string, { ownerUserId: string; anchorSourceKey: string }> {
  const enrichByEvent = new Map<string, { ownerUserId: string; anchorSourceKey: string }>()
  for (const player of players) {
    if (player.user_id === undefined) continue
    for (const day of player.days) {
      enrichByEvent.set(communityEventId(day.anchor_source_key), {
        ownerUserId: player.user_id,
        anchorSourceKey: day.anchor_source_key,
      })
    }
  }
  return enrichByEvent
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

interface ProxyMessageRow {
  message_id: string
  event_id: string
  author_companion_name: string
  author_public_label: string
  body: string
  created_at: string
}

interface ProxyReplyRow {
  message_id: string
  responder_companion_name: string
  responder_public_label: string
  body: string
  created_at: string
}

/* Read every proxy thread hanging off this page of events, grouped by event_id
   (a single event can carry many threads — one per author companion). Both 0007
   tables ship in ONE migration, so the degrade contract is unified: if EITHER
   the message OR the reply table is missing, the whole read degrades to an empty
   map — threads render as [] and `can_reply:true` is never emitted (no
   partial-display state). This keeps the mode① anonymous feed read total across a
   migration/deploy lag. `can_reply` is left false here and finalized per item by
   the caller once viewer flags are known. A fired guard is warned (it must never
   happen in prod, where 0007 is applied before the Worker reads it). */
async function readProxyThreadsByEvent(
  db: ArcadeProfileDb,
  eventIds: string[]
): Promise<Map<string, ArcadeCommunityProxyThread[]>> {
  const byEvent = new Map<string, ArcadeCommunityProxyThread[]>()
  if (eventIds.length === 0) return byEvent

  const placeholders = eventIds.map(() => '?').join(', ')
  let messageRows: ProxyMessageRow[]
  try {
    const { results } = await db
      .prepare(
        `SELECT message_id, event_id, author_companion_name, author_public_label, body, created_at
         FROM arcade_community_proxy_message
         WHERE event_id IN (${placeholders})
         ORDER BY created_at ASC, message_id ASC`
      )
      .bind(...eventIds)
      .all<ProxyMessageRow>()
    messageRows = results
  } catch (error) {
    if (!isMissingProxyTableError(error)) throw error
    console.warn(
      '[arcade-community] proxy 0007 table missing — degrading threads to [] (migration lag?)'
    )
    return byEvent
  }
  if (messageRows.length === 0) return byEvent

  const messageIds = messageRows.map((row) => row.message_id)
  const replyByMessage = new Map<string, ArcadeCommunityProxyReply>()
  try {
    /* D1 caps bound parameters per statement (~100). eventIds is bounded by the
       feed page cap, but messageIds grows with author-threads per event, so the
       reply read chunks its IN() — otherwise a popular window (>100 threads)
       would 500 the whole anonymous mode① feed read (behavioral-pass finding,
       2026-07-14). */
    const REPLY_IN_BATCH_SIZE = 90
    for (let offset = 0; offset < messageIds.length; offset += REPLY_IN_BATCH_SIZE) {
      const batch = messageIds.slice(offset, offset + REPLY_IN_BATCH_SIZE)
      const replyPlaceholders = batch.map(() => '?').join(', ')
      const { results: replyRows } = await db
        .prepare(
          `SELECT message_id, responder_companion_name, responder_public_label, body, created_at
           FROM arcade_community_proxy_reply
           WHERE message_id IN (${replyPlaceholders})`
        )
        .bind(...batch)
        .all<ProxyReplyRow>()
      for (const row of replyRows) {
        replyByMessage.set(row.message_id, {
          responder_companion_name: row.responder_companion_name,
          responder_public_label: row.responder_public_label,
          body: row.body,
          created_at: row.created_at,
        })
      }
    }
  } catch (error) {
    // Unified degrade: a missing reply table (impossible without a missing
    // message table, since both ship in 0007) still collapses the whole read to
    // [] rather than rendering messages with no reply state / a false can_reply.
    if (!isMissingProxyTableError(error)) throw error
    console.warn(
      '[arcade-community] proxy reply 0007 table missing — degrading threads to [] (migration lag?)'
    )
    return byEvent
  }

  for (const row of messageRows) {
    const thread: ArcadeCommunityProxyThread = {
      message_id: row.message_id,
      author_companion_name: row.author_companion_name,
      author_public_label: row.author_public_label,
      body: row.body,
      created_at: row.created_at,
      reply: replyByMessage.get(row.message_id) ?? null,
      can_reply: false, // finalized by the caller with viewer flags
    }
    const list = byEvent.get(row.event_id) ?? []
    list.push(thread)
    byEvent.set(row.event_id, list)
  }
  return byEvent
}

/* Narrow viewer-scoped read: does this account have an AI companion? One
   SELECT 1 on the same COMPANION_DB companion table (migration 0001) — NOT an
   import of the companion-memory package, so no new cross-package dependency
   edge. Absent table (minimal test DB) degrades to false, keeping the feed
   read total. */
async function readViewerHasCompanion(db: ArcadeProfileDb, userId: string): Promise<boolean> {
  try {
    const row = await db
      .prepare(`SELECT 1 AS present FROM companion WHERE user_id = ? LIMIT 1`)
      .bind(userId)
      .first<{ present: number }>()
    return row !== null
  } catch (error) {
    if (!isMissingCompanionTableError(error)) throw error
    console.warn(
      '[arcade-community] companion table missing — viewer_has_companion=false (migration lag?)'
    )
    return false
  }
}

export interface CommunityFeedOptions {
  today?: string
  before?: string
  limit?: number
  /** The signed-in viewer's user_id, when present — used to mark which items
      THEY liked and to derive `viewer_is_owner` / `viewer_has_companion`; never
      serialized. Anonymous reads pass undefined. */
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

  // event_id -> owner (user_id + anchor), for server-side `viewer_is_owner`.
  // Built from the same derived activity the feed came from; never serialized
  // into an item.
  const ownerByEvent = buildOwnerEnrichByEvent(players)

  const viewerHasCompanion = options.viewerUserId
    ? await readViewerHasCompanion(db, options.viewerUserId)
    : false
  const threadsByEvent = await readProxyThreadsByEvent(db, ids)

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
    // Explicit field projection (never a `...item` / `...thread` spread): the
    // serialized wire item is built by naming every field, so no private column
    // could ever ride along even if an upstream row type widened. This is the
    // type-enforced half of the "public_label is the sole identity, never user_id"
    // boundary (the runtime half is asserted by the serialization test).
    items: page.map((item) => {
      const viewerIsOwner =
        options.viewerUserId !== undefined &&
        ownerByEvent.get(item.id)?.ownerUserId === options.viewerUserId
      // can_reply is server-derived per thread: owner + has companion + no reply
      // yet. (Anchor-in-window is implicit — the feed only contains in-window
      // events, so a rendered thread's anchor is always live.)
      const threads = (threadsByEvent.get(item.id) ?? []).map((thread) => ({
        message_id: thread.message_id,
        author_companion_name: thread.author_companion_name,
        author_public_label: thread.author_public_label,
        body: thread.body,
        created_at: thread.created_at,
        reply: thread.reply,
        can_reply: viewerIsOwner && viewerHasCompanion && thread.reply === null,
      }))
      return {
        id: item.id,
        template: item.template,
        public_label: item.public_label,
        at: item.at,
        ...(item.duration_ms !== undefined ? { duration_ms: item.duration_ms } : {}),
        ...(item.streak_days !== undefined ? { streak_days: item.streak_days } : {}),
        like_count: counts.get(item.id) ?? 0,
        liked: likedSet.has(item.id),
        threads,
        viewer_is_owner: viewerIsOwner,
        viewer_has_companion: viewerHasCompanion,
      }
    }),
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

/* --- Companion proxy social (migration 0007) --------------------------------
   The durable write path behind the two generation routes (V1 message, V2 reply,
   in `platform-ai` `companion-proxy-intent.ts`). Each insert is a plain INSERT
   whose UNIQUE / PK collision is the DB-level 一轮封顶 backstop — caught and mapped
   to `inserted: false` rather than surfaced as a 500 (the real-collision path
   behind the route's fast `exists_*` pre-check). */

export interface InsertProxyMessageInput {
  messageId: string
  eventId: string
  anchorSourceKey: string
  authorUserId: string
  authorCompanionName: string
  authorPublicLabel: string
  targetUserId: string
  body: string
}

export interface InsertProxyResult {
  /** True when the row was written. When false, `reason` says why:
      - `duplicate`       — a concurrent duplicate already claimed the uniqueness
        key (V1 message: (event_id, author_user_id) → idempotent messaged:false;
        V2 reply: message_id PK → already-replied);
      - `id-collision`    — (message only) the freshly-minted `message_id` PRIMARY
        KEY clashed — distinct from a (event,author) duplicate; the V1 route
        regenerates the id and retries once;
      - `missing-message` — (reply only) the parent message row does not exist. */
  inserted: boolean
  reason?: 'duplicate' | 'id-collision' | 'missing-message'
}

/* Write one proxy message. A UNIQUE(event_id, author_user_id) collision (this
   author companion already proxied this event) maps to `inserted: false,
   reason: 'duplicate'` — the V1 idempotent "already messaged" path; a message_id
   PRIMARY KEY collision maps to `reason: 'id-collision'` so the route can
   regenerate the id rather than mistake it for a real duplicate. */
export async function insertProxyMessage(
  db: ArcadeProfileDb,
  input: InsertProxyMessageInput,
  deps: StoreDeps = {}
): Promise<InsertProxyResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  try {
    await db
      .prepare(
        `INSERT INTO arcade_community_proxy_message (
           message_id, event_id, anchor_source_key, author_user_id,
           author_companion_name, author_public_label, target_user_id, body, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.messageId,
        input.eventId,
        input.anchorSourceKey,
        input.authorUserId,
        input.authorCompanionName,
        input.authorPublicLabel,
        input.targetUserId,
        input.body,
        now()
      )
      .run()
    return { inserted: true }
  } catch (error) {
    const reason = proxyMessageCollisionReason(error)
    if (reason) return { inserted: false, reason }
    throw error
  }
}

export interface InsertProxyReplyInput {
  messageId: string
  responderCompanionName: string
  responderPublicLabel: string
  body: string
}

/* Write the single reply to a proxy message.
 *
 * Precondition: the reply route MUST 404 on a missing message first (its
 * `load_message` step). This primitive is a defense-in-depth backstop that stays
 * safe INDEPENDENT of that caller discipline: it inserts only when the parent
 * message row exists (one atomic `INSERT ... SELECT ... WHERE EXISTS`, so no
 * orphan reply can ever be written even with FK enforcement off). Outcomes:
 *   - missing parent  → `{ inserted: false, reason: 'missing-message' }` (0 rows);
 *   - message_id PK collision (concurrent second reply) → `{ inserted: false,
 *     reason: 'duplicate' }` — the V2 already-replied path;
 *   - otherwise        → `{ inserted: true }`.
 * Reply-time identity (responder) and the anchor are DERIVED via the message_id
 * join, so no event_id / responder_user_id is stored here. */
export async function insertProxyReply(
  db: ArcadeProfileDb,
  input: InsertProxyReplyInput,
  deps: StoreDeps = {}
): Promise<InsertProxyResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  try {
    const result = await db
      .prepare(
        `INSERT INTO arcade_community_proxy_reply (
           message_id, responder_companion_name, responder_public_label, body, created_at
         )
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM arcade_community_proxy_message WHERE message_id = ?)`
      )
      .bind(
        input.messageId,
        input.responderCompanionName,
        input.responderPublicLabel,
        input.body,
        now(),
        input.messageId
      )
      .run()
    if (result.meta.changes === 0) return { inserted: false, reason: 'missing-message' }
    return { inserted: true }
  } catch (error) {
    if (isUniqueConstraintError(error)) return { inserted: false, reason: 'duplicate' }
    throw error
  }
}

/* Resolve a proxy anchor against the LIVE community feed window. Returns the
   synthesized feed item whose id === eventId when the anchor is still inside the
   14-day window (still emitted by synthesizeCommunityFeed), else null (anchor
   aged out → the reply route answers 410 Gone). The returned item carries the
   live event facts (template / public_label / at / duration_ms? / streak_days?)
   the reply generation reads — the reply row snapshots none of them. */
export async function findInWindowCommunityEvent(
  db: ArcadeProfileDb,
  eventId: string,
  options: { today?: string } = {}
): Promise<ArcadeCommunityFeedItem | null> {
  const today = options.today ?? getTodayString()
  const players = await readCommunityPlayerActivity(db, today)
  const all = synthesizeCommunityFeed({ players, today })
  return all.find((item) => item.id === eventId) ?? null
}

/* --- V1/V2 generation-route reads (round-7-deferred candidate seam) -----------
   These reads complete the candidate-selection + reply-load seam the DATA round
   explicitly handed to the generation route (round-7 report: "candidate selection
   ships with the generation route … must surface anchor_source_key +
   owner_user_id"). They live here because they read arcade-profile's PRIVATE
   derived-feed internals (the owner user_id + anchor_source_key that
   `readArcadeCommunityFeed` strips for the wire). The generation Worker consumes
   them as injected deps and never re-derives the feed itself. Server-only shapes:
   owner / target user_id + anchor_source_key are read for write-time snapshotting
   and never reach a client. */

/** One event a companion (甲) may proxy on — enriched with the private owner +
    anchor the insert needs, plus the live event facts the generation prompt and
    the V1 `target_event` response read. Never serialized to a client. */
export interface ProxyCandidateEvent {
  event_id: string
  anchor_source_key: string
  target_user_id: string
  template: ArcadeCommunityFeedTemplate
  target_public_label: string
  at: string
  duration_ms?: number
  streak_days?: number
}

/* Event ids the author's companion has already proxied on — the fast candidate
   exclusion (the UNIQUE(event_id, author_user_id) is the concurrent backstop
   behind it). Missing 0007 table → null: the migration-lag window must SKIP
   candidate selection entirely (no LLM spend on a generation whose insert cannot
   land), rather than pretending the author has no prior messages. */
async function readAuthorMessagedEventIds(
  db: ArcadeProfileDb,
  authorUserId: string
): Promise<Set<string> | null> {
  try {
    const { results } = await db
      .prepare(`SELECT event_id FROM arcade_community_proxy_message WHERE author_user_id = ?`)
      .bind(authorUserId)
      .all<CommunityLikeEventRow>()
    return new Set(results.map((row) => row.event_id))
  } catch (error) {
    if (!isMissingProxyTableError(error)) throw error
    console.warn(
      '[proxy-social] proxy tables absent during candidate read — skipping proxy generation'
    )
    return null
  }
}

/* In-window events the author may proxy on: not owned by the author, not already
   messaged by the author's companion. Reuses the SAME derived feed as the public
   read (`readCommunityPlayerActivity` + `synthesizeCommunityFeed`), then
   re-attaches the owner user_id + anchor_source_key (dropped from the public item)
   via the day → communityEventId map. Sorted newest-first (feed order), so the
   route's deterministic "pick most recent" candidate is index 0. */
export async function readProxyCandidateEvents(
  db: ArcadeProfileDb,
  authorUserId: string,
  options: { today?: string } = {}
): Promise<ProxyCandidateEvent[]> {
  const today = options.today ?? getTodayString()
  const players = await readCommunityPlayerActivity(db, today)
  const feed = synthesizeCommunityFeed({ players, today })

  const enrichByEvent = buildOwnerEnrichByEvent(players)

  const alreadyMessaged = await readAuthorMessagedEventIds(db, authorUserId)
  // Migration-lag window (0007 not applied yet): no candidates at all — the
  // route answers messaged:false without ever invoking the LLM.
  if (alreadyMessaged === null) return []

  const candidates: ProxyCandidateEvent[] = []
  for (const item of feed) {
    const enrich = enrichByEvent.get(item.id)
    if (enrich === undefined) continue
    if (enrich.ownerUserId === authorUserId) continue // not own
    if (alreadyMessaged.has(item.id)) continue // (event, author) already proxied
    candidates.push({
      event_id: item.id,
      anchor_source_key: enrich.anchorSourceKey,
      target_user_id: enrich.ownerUserId,
      template: item.template,
      target_public_label: item.public_label,
      at: item.at,
      ...(item.duration_ms !== undefined ? { duration_ms: item.duration_ms } : {}),
      ...(item.streak_days !== undefined ? { streak_days: item.streak_days } : {}),
    })
  }
  return candidates
}

/* Count the author's proxy messages authored on a given UTC day — the
   DAILY_PROXY_CAP read (COUNT on idx_proxy_message_author_day). Missing table → 0. */
export async function countAuthorProxyMessagesForDay(
  db: ArcadeProfileDb,
  authorUserId: string,
  options: { day?: string } = {}
): Promise<number> {
  const day = options.day ?? getTodayString()
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM arcade_community_proxy_message
         WHERE author_user_id = ? AND substr(created_at, 1, 10) = ?`
      )
      .bind(authorUserId, day)
      .first<CountRow>()
    return row?.count ?? 0
  } catch (error) {
    if (!isMissingProxyTableError(error)) throw error
    return 0
  }
}

/** A proxy message loaded for the V2 reply route: the reply-auth identity
    (`target_user_id`), the anchor (`event_id`) for the window guard, the original
    `body` the reply generation answers, and whether it is already replied
    (`has_reply`, a LEFT JOIN so the 409 already-replied fast-check needs no second
    read). Server-only; user_ids never reach the wire. */
export interface ProxyMessageRecord {
  message_id: string
  event_id: string
  author_user_id: string
  target_user_id: string
  body: string
  created_at: string
  has_reply: boolean
}

interface ProxyMessageLoadRow {
  message_id: string
  event_id: string
  author_user_id: string
  target_user_id: string
  body: string
  created_at: string
  has_reply: number
}

/* Load one proxy message + its reply-existence flag for the V2 reply route.
   Missing message → null (route 404). Missing 0007 table → null (same 404, safe
   during a migration/deploy lag on the authenticated route). */
export async function loadProxyMessage(
  db: ArcadeProfileDb,
  messageId: string
): Promise<ProxyMessageRecord | null> {
  let row: ProxyMessageLoadRow | null
  try {
    row = await db
      .prepare(
        `SELECT m.message_id, m.event_id, m.author_user_id, m.target_user_id, m.body, m.created_at,
                (r.message_id IS NOT NULL) AS has_reply
         FROM arcade_community_proxy_message m
         LEFT JOIN arcade_community_proxy_reply r ON r.message_id = m.message_id
         WHERE m.message_id = ?
         LIMIT 1`
      )
      .bind(messageId)
      .first<ProxyMessageLoadRow>()
  } catch (error) {
    if (!isMissingProxyTableError(error)) throw error
    return null
  }
  if (!row) return null
  return {
    message_id: row.message_id,
    event_id: row.event_id,
    author_user_id: row.author_user_id,
    target_user_id: row.target_user_id,
    body: row.body,
    created_at: row.created_at,
    has_reply: row.has_reply !== 0,
  }
}
