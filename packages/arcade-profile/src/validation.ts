import { COMMUNITY_EVENT_ID_PATTERN } from './community'
import { bombsquadRunSourceKey, oracleSignSourceKey } from './source-key'
import type {
  ArcadeProfileClaimBody,
  ArcadeProfileEvent,
  BombSquadProfileMode,
  BombSquadProfileOutcome,
  BombSquadProfileRun,
  OracleProfileSign,
} from './types'

const MODES = new Set<BombSquadProfileMode>(['daily', 'practice'])
const OUTCOMES = new Set<BombSquadProfileOutcome>([
  'defused',
  'exploded',
  'practice-cleared',
  'practice-timeout',
  'daily-timeout',
])
const PUBLIC_LABEL_MAX_LENGTH = 28

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUserId(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'user_id')
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

export function defaultArcadePublicLabel(userId: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `Player ${((hash >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`
}

/** Shape of the anonymous `defaultArcadePublicLabel` output: `Player <4-hex>`. */
const GENERATED_LABEL_PATTERN = /^Player [0-9A-F]{4}$/

/**
 * True when `label` is the anonymous generated placeholder (`Player 53CD`) and
 * carries no real name signal. Used so a real name never gets overwritten AND a
 * stale placeholder can be upgraded once a better signal (chosen nickname or
 * account email) is available.
 */
export function isGeneratedArcadePublicLabel(label: string): boolean {
  return GENERATED_LABEL_PATTERN.test(label)
}

/**
 * Account-derived default label: the email local-part, sanitized as a public
 * label. Falls back to the anonymous `Player <hex>` placeholder only when the
 * local-part sanitizes to nothing (no usable name signal at all).
 */
export function accountDerivedPublicLabel(email: string, userId: string): string {
  const localPart = email.split('@')[0] ?? ''
  return sanitizeArcadePublicLabel(localPart, userId)
}

/**
 * Resolve the public label to store for a claim, by honest precedence:
 *
 *   1. client-provided label (the player's chosen nickname) when it sanitizes
 *      to a real name — NOT to the generated placeholder;
 *   2. an existing stored label that is already a real name (never clobber a
 *      name the user set);
 *   3. the account-derived default (email local-part);
 *   4. the anonymous `Player <hex>` placeholder (last resort — only when there
 *      is no email signal, which should not happen for a logged-in user).
 *
 * A logged-in user with any real name signal therefore never lands on
 * `Player XXXX`, and an existing placeholder row is upgraded on the next claim.
 */
export function resolveArcadePublicLabel(input: {
  clientLabel?: string
  existingLabel: string | null
  email: string
  userId: string
}): string {
  if (typeof input.clientLabel === 'string' && input.clientLabel.trim().length > 0) {
    const sanitized = sanitizeArcadePublicLabel(input.clientLabel, input.userId)
    // A client label that survives sanitization as a real name wins. If it
    // sanitizes down to the generated placeholder (only illegal chars), fall
    // through to the account-derived default rather than storing `Player XXXX`.
    if (!isGeneratedArcadePublicLabel(sanitized)) return sanitized
  }
  if (input.existingLabel && !isGeneratedArcadePublicLabel(input.existingLabel)) {
    return input.existingLabel
  }
  return accountDerivedPublicLabel(input.email, input.userId)
}

export function sanitizeArcadePublicLabel(value: unknown, userId: string): string {
  if (typeof value !== 'string') return defaultArcadePublicLabel(userId)
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return defaultArcadePublicLabel(userId)
  if (trimmed.includes('@') || /^https?:\/\//i.test(trimmed)) {
    return defaultArcadePublicLabel(userId)
  }
  const safe = Array.from(trimmed)
    .filter((char) => /[\p{L}\p{N} _.'-]/u.test(char))
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PUBLIC_LABEL_MAX_LENGTH)
  return safe.length > 0 ? safe : defaultArcadePublicLabel(userId)
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < min || value > max) return null
  return value
}

function isoDateTime(value: unknown): string | null {
  const candidate = text(value, 40)
  if (candidate === null) return null
  const time = Date.parse(candidate)
  return Number.isNaN(time) ? null : candidate
}

function isoDate(value: unknown): string | null {
  const candidate = text(value, 10)
  if (candidate === null) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null
}

function parseBombSquadRun(value: unknown): BombSquadProfileRun | null {
  if (!isObject(value) || hasUserId(value)) return null
  const runId = text(value.run_id, 120)
  const sourceKey = text(value.source_key, 180)
  const mode = text(value.mode, 20) as BombSquadProfileMode | null
  const outcome = text(value.outcome, 40) as BombSquadProfileOutcome | null
  const durationMs = integer(value.duration_ms, 0, 3_600_000)
  const attemptNumber = integer(value.attempt_number, 1, 10_000)
  const moduleCount = integer(value.module_count, 0, 20)
  const completedModules = integer(value.completed_modules, 0, 20)
  const strikeCount = integer(value.strike_count, 0, 100)
  const finishedAt = isoDateTime(value.finished_at)
  if (
    runId === null ||
    sourceKey === null ||
    mode === null ||
    outcome === null ||
    durationMs === null ||
    attemptNumber === null ||
    moduleCount === null ||
    completedModules === null ||
    strikeCount === null ||
    finishedAt === null
  ) {
    return null
  }
  if (!MODES.has(mode) || !OUTCOMES.has(outcome)) return null
  if (completedModules > moduleCount) return null
  if (sourceKey !== bombsquadRunSourceKey(runId)) return null
  return {
    source_key: sourceKey,
    run_id: runId,
    mode,
    outcome,
    duration_ms: durationMs,
    attempt_number: attemptNumber,
    module_count: moduleCount,
    completed_modules: completedModules,
    strike_count: strikeCount,
    finished_at: finishedAt,
  }
}

function parseYaoValues(value: unknown): OracleProfileSign['yao_values'] | null {
  if (!Array.isArray(value) || value.length !== 6) return null
  const values = value.map((item) => integer(item, 6, 9))
  if (values.some((item) => item === null)) return null
  return values as OracleProfileSign['yao_values']
}

function parseOracleSign(value: unknown): OracleProfileSign | null {
  if (!isObject(value) || hasUserId(value)) return null
  const sessionId = text(value.session_id, 120)
  const sourceKey = text(value.source_key, 180)
  const signDate = isoDate(value.sign_date)
  const ben = text(value.ben, 20)
  const bian = text(value.bian, 20)
  const yaoValues = parseYaoValues(value.yao_values)
  const createdAt = isoDateTime(value.created_at)
  if (
    sessionId === null ||
    sourceKey === null ||
    signDate === null ||
    ben === null ||
    bian === null ||
    yaoValues === null ||
    createdAt === null
  ) {
    return null
  }
  if (sourceKey !== oracleSignSourceKey(signDate, sessionId)) return null
  return {
    source_key: sourceKey,
    session_id: sessionId,
    sign_date: signDate,
    ben,
    bian,
    yao_values: yaoValues,
    created_at: createdAt,
  }
}

export function parseArcadeProfileEvent(value: unknown): ArcadeProfileEvent | null {
  if (!isObject(value) || hasUserId(value)) return null
  const profileId = value.profile_id === undefined ? undefined : text(value.profile_id, 120)
  if (value.profile_id !== undefined && profileId === null) return null
  if (value.kind === 'bombsquad_run') {
    const run = parseBombSquadRun(value.run)
    return run
      ? { kind: 'bombsquad_run', ...(profileId ? { profile_id: profileId } : {}), run }
      : null
  }
  if (value.kind === 'oracle_sign') {
    const sign = parseOracleSign(value.sign)
    return sign
      ? { kind: 'oracle_sign', ...(profileId ? { profile_id: profileId } : {}), sign }
      : null
  }
  return null
}

/**
 * Parse a community-like request body to its opaque event id, or null.
 *
 * The event id must match the `communityEventId` output shape exactly
 * (`e` + 16 hex) — this bounds the key space to what real feed events mint, so
 * a malicious client cannot flood `arcade_community_like` with arbitrary keys.
 * The owner (liker) identity is NEVER read from the body — the handler derives
 * it from the session — so a smuggled `user_id` field is simply ignored.
 */
export function parseCommunityLikeBody(value: unknown): { event_id: string } | null {
  if (!isObject(value)) return null
  if (typeof value.event_id !== 'string') return null
  return COMMUNITY_EVENT_ID_PATTERN.test(value.event_id) ? { event_id: value.event_id } : null
}

export function parseArcadeProfileClaimBody(value: unknown): ArcadeProfileClaimBody | null {
  if (!isObject(value) || hasUserId(value)) return null
  const profileId = text(value.profile_id, 120)
  if (profileId === null) return null
  if (!Array.isArray(value.events) || value.events.length > 100) return null
  const events = value.events.map(parseArcadeProfileEvent)
  if (events.some((event) => event === null)) return null
  return {
    profile_id: profileId,
    events: (events as ArcadeProfileEvent[]).map((event) => ({
      ...event,
      profile_id: event.profile_id ?? profileId,
    })),
    ...(typeof value.public_label === 'string' ? { public_label: value.public_label } : {}),
  }
}
