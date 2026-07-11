/**
 * Reward-economy ledger: read/credit/deduct over `asset_entry` (migration
 * 0001 + the 0006 read index).
 *
 * Pure data access — no HTTP, no auth, no LLM — mirroring `store.ts`. Every
 * function takes the `userId` the CALLER derived from the server-side session
 * (require-session guard); nothing here trusts a client-supplied owner id.
 *
 * The ledger is the single source of truth for balance: `SUM(amount)` over the
 * append-only entries, no materialized balance cell and no read-modify-write.
 * A credit or deduct is ONE `INSERT ... ON CONFLICT (source_key) DO NOTHING`
 * (a single D1 statement is atomic — no `db.batch` for one row), so replays and
 * double-fires are row-level no-ops. Source-key construction lives in
 * `idempotency.ts`; numeric amounts live in `economy.ts`.
 */

import type { CompanionDb } from './db'
import type { DomainDeps } from './deps'
import { defaultDeps } from './deps'
import {
  ASSET_TYPE_STARBURST,
  CHECKIN_REWARD,
  DAILY_WIN_CAP,
  WELCOME_GRANT,
  WIN_REWARD,
} from './economy'
import {
  checkinSourceKey,
  sessionDeductSourceKey,
  welcomeSourceKey,
  winSourceKey,
} from './idempotency'

// --- entries view -------------------------------------------------------------

const ENTRIES_PAGE_DEFAULT = 20
const ENTRIES_PAGE_MAX = 50

/** Per-row display kind, derived from the `source_key` prefix (never stored). */
export type AssetEntryKind = 'win' | 'checkin' | 'welcome' | 'session' | 'other'

/**
 * One ledger row as exposed to the caller. The internal `id` is NEVER here — it
 * lives only inside the opaque cursor (design §2, finding 7); `source_ref` is
 * internal provenance and also omitted.
 */
export interface AssetEntryView {
  amount: number
  source_product: string
  kind: AssetEntryKind
  earned_at: string
}

export interface AssetsPage {
  entries: AssetEntryView[]
  nextCursor?: string
}

interface AssetEntryRow {
  id: string
  amount: number
  source_product: string
  source_key: string
  earned_at: string
}

interface AssetCursor {
  o: string
  id: string
}

function encodeCursor(cursor: AssetCursor): string {
  return btoa(JSON.stringify(cursor))
}

function decodeCursor(raw: string): AssetCursor | null {
  try {
    const parsed = JSON.parse(atob(raw)) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as AssetCursor).o === 'string' &&
      typeof (parsed as AssetCursor).id === 'string'
    ) {
      return parsed as AssetCursor
    }
    return null
  } catch {
    return null
  }
}

function deriveKind(sourceKey: string): AssetEntryKind {
  if (sourceKey.startsWith('win:')) return 'win'
  if (sourceKey.startsWith('checkin:')) return 'checkin'
  if (sourceKey.startsWith('welcome:')) return 'welcome'
  if (sourceKey.startsWith('session:')) return 'session'
  return 'other'
}

// --- reads --------------------------------------------------------------------

/**
 * Current balance for one asset type: `COALESCE(SUM(amount), 0)`. `Number()`
 * guards against a bigint from the SQLite driver; an empty ledger reads 0.
 */
export async function readBalance(
  db: CompanionDb,
  userId: string,
  assetType: string = ASSET_TYPE_STARBURST
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS balance FROM asset_entry WHERE user_id = ? AND asset_type = ?'
    )
    .bind(userId, assetType)
    .first<{ balance: number }>()
  return Number(row?.balance ?? 0)
}

/** Whether a row with this exact `source_key` already exists (any user). */
export async function existsBySourceKey(db: CompanionDb, sourceKey: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS present FROM asset_entry WHERE source_key = ? LIMIT 1')
    .bind(sourceKey)
    .first<{ present: number }>()
  return row !== null
}

/**
 * Keyset-paginated ledger entries, newest first (`earned_at DESC, id DESC`).
 * `id` is selected only to build the opaque cursor `{ o: earned_at, id }` and
 * is never surfaced in a row. Scoped to one asset type to match the balance.
 * A malformed cursor is treated as "first page", not an error.
 */
export async function listAssetEntries(
  db: CompanionDb,
  userId: string,
  options: { limit?: number; cursor?: string; assetType?: string } = {}
): Promise<AssetsPage> {
  const limit = Math.min(Math.max(options.limit ?? ENTRIES_PAGE_DEFAULT, 1), ENTRIES_PAGE_MAX)
  const assetType = options.assetType ?? ASSET_TYPE_STARBURST
  const cursor = options.cursor === undefined ? null : decodeCursor(options.cursor)

  const statement =
    cursor === null
      ? db
          .prepare(
            `SELECT id, amount, source_product, source_key, earned_at
             FROM asset_entry
             WHERE user_id = ? AND asset_type = ?
             ORDER BY earned_at DESC, id DESC
             LIMIT ?`
          )
          .bind(userId, assetType, limit + 1)
      : db
          .prepare(
            `SELECT id, amount, source_product, source_key, earned_at
             FROM asset_entry
             WHERE user_id = ? AND asset_type = ?
               AND (earned_at < ? OR (earned_at = ? AND id < ?))
             ORDER BY earned_at DESC, id DESC
             LIMIT ?`
          )
          .bind(userId, assetType, cursor.o, cursor.o, cursor.id, limit + 1)

  const { results } = await statement.all<AssetEntryRow>()
  const rows = results.slice(0, limit)
  const hasMore = results.length > limit
  const last = rows[rows.length - 1]
  const entries: AssetEntryView[] = rows.map((r) => ({
    amount: Number(r.amount),
    source_product: r.source_product,
    kind: deriveKind(r.source_key),
    earned_at: r.earned_at,
  }))
  return {
    entries,
    ...(hasMore && last ? { nextCursor: encodeCursor({ o: last.earned_at, id: last.id }) } : {}),
  }
}

// --- daily win cap ------------------------------------------------------------

function utcDayStart(utcDate: string): string {
  return `${utcDate}T00:00:00.000Z`
}

function utcNextDayStart(utcDate: string): string {
  const d = new Date(utcDayStart(utcDate))
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

/**
 * Rewarded wins the user already earned on `today` (UTC `YYYY-MM-DD`), COMBINED
 * across games — a `win:*` COUNT over the half-open UTC-day range. The ledger
 * is the counter (no separate cell); the cap is soft under concurrency (design
 * §3/§11).
 */
export async function countTodaysRewardedWins(
  db: CompanionDb,
  userId: string,
  today: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM asset_entry
       WHERE user_id = ? AND asset_type = ? AND source_key GLOB 'win:*'
         AND earned_at >= ? AND earned_at < ?`
    )
    .bind(userId, ASSET_TYPE_STARBURST, utcDayStart(today), utcNextDayStart(today))
    .first<{ c: number }>()
  return Number(row?.c ?? 0)
}

// --- credits ------------------------------------------------------------------

export type CreditWinResult =
  | { status: 'credited'; amount: number; balance: number }
  | { status: 'duplicate'; amount: number; balance: number }
  | { status: 'capped'; amount: number; balance: number }
  | { status: 'error'; amount: number }

export interface CreditWinInput {
  userId: string
  gameId: string
  runId: string
  /** UTC `YYYY-MM-DD` for the daily-cap window (caller-derived). */
  today: string
  deps?: DomainDeps
}

/**
 * Credit +5 星芒 for one game win, synchronously at the settlement handler
 * (design §3). Self-guarding contract:
 *   - a replayed already-rewarded run returns `duplicate` (looked up BEFORE the
 *     cap, so a replay is never miscounted as `capped`);
 *   - a run past the daily cap returns `capped`;
 *   - an insert that loses the race (ON CONFLICT no-op) returns `duplicate`;
 *   - any D1 failure returns `error` — FAIL-OPEN: the caller keeps the
 *     settlement succeeding and omits the reward field.
 */
export async function creditWinReward(
  db: CompanionDb,
  input: CreditWinInput
): Promise<CreditWinResult> {
  const deps = input.deps ?? defaultDeps
  try {
    const key = winSourceKey(input.gameId, input.userId, input.runId)
    if (await existsBySourceKey(db, key)) {
      return { status: 'duplicate', amount: 0, balance: await readBalance(db, input.userId) }
    }
    if ((await countTodaysRewardedWins(db, input.userId, input.today)) >= DAILY_WIN_CAP) {
      return { status: 'capped', amount: 0, balance: await readBalance(db, input.userId) }
    }
    const result = await db
      .prepare(
        `INSERT INTO asset_entry (id, user_id, asset_type, amount, source_product, source_ref, source_key, earned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source_key) DO NOTHING`
      )
      .bind(
        deps.newId(),
        input.userId,
        ASSET_TYPE_STARBURST,
        WIN_REWARD,
        input.gameId,
        input.runId,
        key,
        deps.now()
      )
      .run()
    if (result.meta.changes === 0) {
      return { status: 'duplicate', amount: 0, balance: await readBalance(db, input.userId) }
    }
    return { status: 'credited', amount: WIN_REWARD, balance: await readBalance(db, input.userId) }
  } catch {
    return { status: 'error', amount: 0 }
  }
}

export interface CreditResult {
  credited: boolean
  amount: number
  balance: number
}

/**
 * Credit +3 星芒 for the first qualified activity of the UTC day. The
 * `checkin:{userId}:{today}` unique key makes only the day's FIRST attempt
 * insert; every later one no-ops (`credited: false`). The caller wraps this in
 * try/catch so the profile write always succeeds (design §4 fail-open).
 */
export async function creditCheckinReward(
  db: CompanionDb,
  userId: string,
  today: string,
  deps: DomainDeps = defaultDeps
): Promise<CreditResult> {
  const result = await db
    .prepare(
      `INSERT INTO asset_entry (id, user_id, asset_type, amount, source_product, source_ref, source_key, earned_at)
       VALUES (?, ?, ?, ?, 'amiclaw', 'checkin', ?, ?)
       ON CONFLICT (source_key) DO NOTHING`
    )
    .bind(
      deps.newId(),
      userId,
      ASSET_TYPE_STARBURST,
      CHECKIN_REWARD,
      checkinSourceKey(userId, today),
      deps.now()
    )
    .run()
  const credited = result.meta.changes > 0
  return { credited, amount: credited ? CHECKIN_REWARD : 0, balance: await readBalance(db, userId) }
}

/**
 * Mint the +10 星芒 welcome grant, exactly once ever per user via the
 * `welcome:{userId}` unique key. Idempotent across both mint points (assets
 * endpoint + session-create gate, design §6). The caller wraps in try/catch.
 */
export async function creditWelcomeGrant(
  db: CompanionDb,
  userId: string,
  deps: DomainDeps = defaultDeps
): Promise<{ credited: boolean }> {
  const result = await db
    .prepare(
      `INSERT INTO asset_entry (id, user_id, asset_type, amount, source_product, source_ref, source_key, earned_at)
       VALUES (?, ?, ?, ?, 'amiclaw', 'welcome', ?, ?)
       ON CONFLICT (source_key) DO NOTHING`
    )
    .bind(
      deps.newId(),
      userId,
      ASSET_TYPE_STARBURST,
      WELCOME_GRANT,
      welcomeSourceKey(userId),
      deps.now()
    )
    .run()
  return { credited: result.meta.changes > 0 }
}

// --- deduct -------------------------------------------------------------------

export interface DeductSessionInput {
  userId: string
  sessionId: string
  /** Elapsed minutes billed; MUST be a finite positive integer (NaN guard). */
  minutes: number
  /** Funding-source marker, persisted in `source_ref` (v1 always `earned`). */
  fundingSource: string
  deps?: DomainDeps
}

export interface DeductResult {
  deducted: boolean
  amount: number
}

/**
 * Write the single negative deduct row for one voice session
 * (`session:{sessionId}`, `amount = -minutes`).
 *
 * NaN-poison HARD INVARIANT (design §10): a non-finite / non-integer /
 * non-positive `minutes` is REFUSED with no write — a NaN amount would
 * permanently poison `SUM(amount)` and can never be undone. The single-row
 * unique key makes a double-fired teardown a no-op (`deducted: false`).
 */
export async function deductSessionMinutes(
  db: CompanionDb,
  input: DeductSessionInput
): Promise<DeductResult> {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    return { deducted: false, amount: 0 }
  }
  const deps = input.deps ?? defaultDeps
  const result = await db
    .prepare(
      `INSERT INTO asset_entry (id, user_id, asset_type, amount, source_product, source_ref, source_key, earned_at)
       VALUES (?, ?, ?, ?, 'amiclaw', ?, ?, ?)
       ON CONFLICT (source_key) DO NOTHING`
    )
    .bind(
      deps.newId(),
      input.userId,
      ASSET_TYPE_STARBURST,
      -input.minutes,
      `session:${input.fundingSource}`,
      sessionDeductSourceKey(input.sessionId),
      deps.now()
    )
    .run()
  const deducted = result.meta.changes > 0
  return { deducted, amount: deducted ? -input.minutes : 0 }
}
