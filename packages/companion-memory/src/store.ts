/**
 * SQL operations over the Companion D1 schema (migrations/0001).
 *
 * Pure data access — no HTTP, no auth, no LLM. Every owner-scoped operation
 * takes the `userId` as an explicit parameter that the CALLER must have
 * derived from the server-side session (require-session guard); nothing here
 * ever trusts a client-supplied owner id.
 *
 * Write-path idempotency: every consolidation-produced insert carries a
 * source-derived unique key and is `ON CONFLICT DO NOTHING`, so replays are
 * no-ops at the row level (see `idempotency.ts`).
 */

import type { CompanionDb, CompanionDbStatement } from './db'
import type { DomainDeps } from './deps'
import { defaultDeps } from './deps'
import { correctionSourceKey } from './idempotency'
import type {
  CompanionRecord,
  MemoryView,
  ProfileClaimEvidenceView,
  ProfileClaimRecord,
  ProfileClaimView,
} from './types'

// --- companion ---------------------------------------------------------------

export async function getCompanion(
  db: CompanionDb,
  userId: string
): Promise<CompanionRecord | null> {
  return db
    .prepare('SELECT * FROM companion WHERE user_id = ?')
    .bind(userId)
    .first<CompanionRecord>()
}

export interface CreateCompanionInput {
  userId: string
  name: string
  voiceId: string
  addressStyle?: string
}

/**
 * Create the user's companion. Returns the created record, or `null` when a
 * companion already exists (the user_id PK is the 1:1 invariant — there is no
 * second-companion path, so the caller maps `null` to 409).
 */
export async function createCompanion(
  db: CompanionDb,
  input: CreateCompanionInput,
  deps: DomainDeps = defaultDeps
): Promise<CompanionRecord | null> {
  const result = await db
    .prepare(
      `INSERT INTO companion (user_id, name, address_style, voice_id, profile_enabled, created_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT (user_id) DO NOTHING`
    )
    .bind(input.userId, input.name, input.addressStyle ?? '', input.voiceId, deps.now())
    .run()
  if (result.meta.changes === 0) return null
  return getCompanion(db, input.userId)
}

/**
 * Persist the remembered auto-voice posture (presence layer; the caller has
 * already narrowed the value to the `VoicePosture` enum — the column CHECK is
 * the last line of defence). Returns false when no companion.
 */
export async function setVoicePosture(
  db: CompanionDb,
  userId: string,
  posture: string
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE companion SET voice_posture = ? WHERE user_id = ?')
    .bind(posture, userId)
    .run()
  return result.meta.changes > 0
}

/** Flip the profile (understanding layer) switch. Returns false when no companion. */
export async function setProfileEnabled(
  db: CompanionDb,
  userId: string,
  enabled: boolean
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE companion SET profile_enabled = ? WHERE user_id = ?')
    .bind(enabled ? 1 : 0, userId)
    .run()
  return result.meta.changes > 0
}

// --- episodes (memory album) ---------------------------------------------------

const MEMORY_PAGE_DEFAULT = 20
const MEMORY_PAGE_MAX = 50

export interface MemoryPage {
  memories: MemoryView[]
  nextCursor?: string
}

interface MemoryCursor {
  o: string
  id: string
}

function encodeCursor(cursor: MemoryCursor): string {
  return btoa(JSON.stringify(cursor))
}

function decodeCursor(raw: string): MemoryCursor | null {
  try {
    const parsed = JSON.parse(atob(raw)) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as MemoryCursor).o === 'string' &&
      typeof (parsed as MemoryCursor).id === 'string'
    ) {
      return parsed as MemoryCursor
    }
    return null
  } catch {
    return null
  }
}

/**
 * Keyset-paginated active episodes, newest first (occurred_at DESC, id DESC
 * tiebreak). A malformed cursor is treated as "first page" rather than an
 * error — the cursor is opaque convenience state, not a correctness input.
 */
export async function listMemories(
  db: CompanionDb,
  userId: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<MemoryPage> {
  const limit = Math.min(Math.max(options.limit ?? MEMORY_PAGE_DEFAULT, 1), MEMORY_PAGE_MAX)
  const cursor = options.cursor === undefined ? null : decodeCursor(options.cursor)

  let statement: CompanionDbStatement
  if (cursor === null) {
    statement = db
      .prepare(
        `SELECT id, occurred_at, game_id, title, narrative
         FROM episode
         WHERE user_id = ? AND status = 'active'
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?`
      )
      .bind(userId, limit + 1)
  } else {
    statement = db
      .prepare(
        `SELECT id, occurred_at, game_id, title, narrative
         FROM episode
         WHERE user_id = ? AND status = 'active'
           AND (occurred_at < ? OR (occurred_at = ? AND id < ?))
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?`
      )
      .bind(userId, cursor.o, cursor.o, cursor.id, limit + 1)
  }

  const { results } = await statement.all<MemoryView>()
  const page = results.slice(0, limit)
  const hasMore = results.length > limit
  const last = page[page.length - 1]
  return {
    memories: page,
    ...(hasMore && last ? { nextCursor: encodeCursor({ o: last.occurred_at, id: last.id }) } : {}),
  }
}

/**
 * Soft-delete one episode the user owns. The schema trigger cascades: claims
 * whose active evidence drops to zero leave 'active'. Returns false when the
 * episode does not exist, is not owned by `userId`, or is already deleted.
 */
export async function deleteMemory(
  db: CompanionDb,
  userId: string,
  episodeId: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE episode SET status = 'deleted'
       WHERE id = ? AND user_id = ? AND status = 'active'`
    )
    .bind(episodeId, userId)
    .run()
  return result.meta.changes > 0
}

// --- profile claims (control plane) -------------------------------------------

/**
 * Active claims WITH their evidence chains, for `GET /api/companion/profile`
 * — every understanding links back to visible memories. Only claims holding
 * >=1 ACTIVE evidence episode are returned: a claim without live evidence is
 * never active-surfaced anywhere (read-side enforcement of the
 * no-black-box-profiling invariant, on top of the schema trigger).
 */
export async function listActiveClaimsWithEvidence(
  db: CompanionDb,
  userId: string
): Promise<ProfileClaimView[]> {
  const { results: claims } = await db
    .prepare(
      `SELECT pc.*
       FROM profile_claim pc
       WHERE pc.user_id = ? AND pc.status = 'active'
         AND EXISTS (
           SELECT 1 FROM profile_claim_evidence pce
           JOIN episode e ON e.id = pce.episode_id
           WHERE pce.profile_claim_id = pc.id AND e.status = 'active'
         )
       ORDER BY pc.updated_at DESC, pc.id DESC`
    )
    .bind(userId)
    .all<ProfileClaimRecord>()

  const views: ProfileClaimView[] = []
  for (const claim of claims) {
    const { results: evidence } = await db
      .prepare(
        `SELECT e.id AS episode_id, e.title, e.occurred_at, e.game_id
         FROM profile_claim_evidence pce
         JOIN episode e ON e.id = pce.episode_id
         WHERE pce.profile_claim_id = ? AND e.status = 'active'
         ORDER BY e.occurred_at DESC`
      )
      .bind(claim.id)
      .all<ProfileClaimEvidenceView>()
    views.push({
      id: claim.id,
      dimension: claim.dimension,
      claim: claim.claim,
      status: claim.status,
      updated_at: claim.updated_at,
      evidence,
    })
  }
  return views
}

/**
 * Player correction: the original claim turns 'corrected', the correction is
 * kept as a NEW active claim that inherits the original's evidence links (the
 * correction re-words the understanding; the underlying lived episodes are
 * the same). Returns the new claim view, or `null` when the original does not
 * exist, is not owned by `userId`, or is not active.
 */
export async function correctClaim(
  db: CompanionDb,
  userId: string,
  claimId: string,
  correction: string,
  deps: DomainDeps = defaultDeps
): Promise<ProfileClaimView | null> {
  const original = await db
    .prepare(`SELECT * FROM profile_claim WHERE id = ? AND user_id = ? AND status = 'active'`)
    .bind(claimId, userId)
    .first<ProfileClaimRecord>()
  if (original === null) return null

  const newId = deps.newId()
  const now = deps.now()
  await db.batch([
    db
      .prepare(`UPDATE profile_claim SET status = 'corrected', updated_at = ? WHERE id = ?`)
      .bind(now, claimId),
    db
      .prepare(
        `INSERT INTO profile_claim (id, user_id, dimension, claim, status, source_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .bind(newId, userId, original.dimension, correction, correctionSourceKey(claimId), now, now),
    db
      .prepare(
        `INSERT INTO profile_claim_evidence (profile_claim_id, episode_id, created_at)
         SELECT ?, episode_id, ? FROM profile_claim_evidence WHERE profile_claim_id = ?`
      )
      .bind(newId, now, claimId),
  ])

  const { results: evidence } = await db
    .prepare(
      `SELECT e.id AS episode_id, e.title, e.occurred_at, e.game_id
       FROM profile_claim_evidence pce
       JOIN episode e ON e.id = pce.episode_id
       WHERE pce.profile_claim_id = ? AND e.status = 'active'
       ORDER BY e.occurred_at DESC`
    )
    .bind(newId)
    .all<ProfileClaimEvidenceView>()

  return {
    id: newId,
    dimension: original.dimension,
    claim: correction,
    status: 'active',
    updated_at: now,
    evidence,
  }
}

/**
 * Player hard-delete of one claim (the L2 spec's profile-layer hard delete —
 * the profile is the player's to erase): the row is removed and its evidence
 * links cascade away (ON DELETE CASCADE). Returns false when the claim does
 * not exist or is not owned by `userId`.
 */
export async function deleteClaim(
  db: CompanionDb,
  userId: string,
  claimId: string
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM profile_claim WHERE id = ? AND user_id = ?')
    .bind(claimId, userId)
    .run()
  return result.meta.changes > 0
}

/**
 * Player hard-delete of the WHOLE profile (`DELETE /api/companion/profile`,
 * the "or all of it" half of the L2 delete operation). Removes every claim
 * row the user owns — any status, history included — with the same cascade
 * semantics as the single delete (evidence links go via ON DELETE CASCADE).
 * In the SAME atomic batch, the companion's `profile_deleted_at` watermark is
 * set to now: capture events created at-or-before that instant can never
 * produce claims when the async consolidator processes them later, so a
 * pending event cannot resurrect the profile the player just erased.
 * Returns the number of claims removed; idempotent — re-deleting an empty
 * profile removes zero rows (and merely advances the watermark).
 */
export async function deleteAllClaims(
  db: CompanionDb,
  userId: string,
  deps: DomainDeps = defaultDeps
): Promise<number> {
  const [deleted] = await db.batch([
    db.prepare('DELETE FROM profile_claim WHERE user_id = ?').bind(userId),
    db
      .prepare('UPDATE companion SET profile_deleted_at = ? WHERE user_id = ?')
      .bind(deps.now(), userId),
  ])
  return deleted.meta.changes
}
