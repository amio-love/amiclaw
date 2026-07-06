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
  }
}
