import { getTodayString } from '../../../shared/date'
import { summarizeArcadeProfile } from './summary'
import { bombsquadRunSourceKey, oracleSignSourceKey } from './source-key'
import { parseArcadeProfileEvent } from './validation'
import type {
  ArcadeLocalProfile,
  ArcadeProfileEvent,
  ArcadeProfileSummary,
  BombSquadProfileOutcome,
  BombSquadProfileRun,
  BombSquadProfileMode,
  OracleProfileSign,
} from './types'

export const ARCADE_LOCAL_PROFILE_KEY = 'arcade-local-profile-v1'

const MAX_LOCAL_RUNS = 100
const MAX_LOCAL_SIGNS = 100

function nowIso(): string {
  return new Date().toISOString()
}

function randomProfileId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `local-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

function browserStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

function emptyProfile(timestamp = nowIso()): ArcadeLocalProfile {
  return {
    version: 1,
    profile_id: randomProfileId(),
    created_at: timestamp,
    updated_at: timestamp,
    last_seen_at: timestamp,
    bombsquad_runs: [],
    oracle_signs: [],
    claimed_source_keys: [],
  }
}

function isLocalProfile(value: unknown): value is ArcadeLocalProfile {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as ArcadeLocalProfile
  return (
    profile.version === 1 &&
    typeof profile.profile_id === 'string' &&
    typeof profile.created_at === 'string' &&
    typeof profile.updated_at === 'string' &&
    typeof profile.last_seen_at === 'string' &&
    Array.isArray(profile.bombsquad_runs) &&
    Array.isArray(profile.oracle_signs) &&
    Array.isArray(profile.claimed_source_keys)
  )
}

function sanitizeLocalProfile(value: unknown): ArcadeLocalProfile | null {
  if (!isLocalProfile(value)) return null
  return {
    ...value,
    bombsquad_runs: value.bombsquad_runs
      .map((run) => {
        const event = parseArcadeProfileEvent({ kind: 'bombsquad_run', run })
        return event?.kind === 'bombsquad_run' ? event.run : null
      })
      .filter((run): run is BombSquadProfileRun => run !== null)
      .slice(0, MAX_LOCAL_RUNS),
    oracle_signs: value.oracle_signs
      .map((sign) => {
        const event = parseArcadeProfileEvent({ kind: 'oracle_sign', sign })
        return event?.kind === 'oracle_sign' ? event.sign : null
      })
      .filter((sign): sign is OracleProfileSign => sign !== null)
      .slice(0, MAX_LOCAL_SIGNS),
    claimed_source_keys: value.claimed_source_keys.filter(
      (sourceKey): sourceKey is string => typeof sourceKey === 'string' && sourceKey.length > 0
    ),
  }
}

function saveProfile(profile: ArcadeLocalProfile, storage = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(ARCADE_LOCAL_PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // Local persistence is best-effort; gameplay must never depend on it.
  }
}

export function readArcadeLocalProfile(storage = browserStorage()): ArcadeLocalProfile | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(ARCADE_LOCAL_PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return sanitizeLocalProfile(parsed)
  } catch {
    return null
  }
}

export function ensureArcadeLocalProfile(storage = browserStorage()): ArcadeLocalProfile {
  const timestamp = nowIso()
  const existing = readArcadeLocalProfile(storage)
  const profile = existing ?? emptyProfile(timestamp)
  profile.last_seen_at = timestamp
  profile.updated_at = timestamp
  saveProfile(profile, storage)
  return profile
}

function upsertBySourceKey<T extends { source_key: string }>(
  entries: T[],
  next: T,
  limit: number,
  getDate: (entry: T) => string
): T[] {
  return [next, ...entries.filter((entry) => entry.source_key !== next.source_key)]
    .sort((a, b) => getDate(b).localeCompare(getDate(a)))
    .slice(0, limit)
}

export interface RecordBombSquadLocalRunInput {
  runId: string
  mode: BombSquadProfileMode
  outcome: BombSquadProfileOutcome
  durationMs: number
  attemptNumber: number
  moduleCount: number
  completedModules: number
  strikeCount: number
  finishedAt?: string
}

export function recordBombSquadLocalRun(
  input: RecordBombSquadLocalRunInput,
  storage = browserStorage()
): ArcadeProfileEvent | null {
  if (input.durationMs < 0 || input.runId.length === 0) return null
  const profile = ensureArcadeLocalProfile(storage)
  const timestamp = nowIso()
  const run: BombSquadProfileRun = {
    source_key: bombsquadRunSourceKey(input.runId),
    run_id: input.runId,
    mode: input.mode,
    outcome: input.outcome,
    duration_ms: Math.round(input.durationMs),
    attempt_number: input.attemptNumber,
    module_count: input.moduleCount,
    completed_modules: input.completedModules,
    strike_count: input.strikeCount,
    finished_at: input.finishedAt ?? timestamp,
  }
  profile.bombsquad_runs = upsertBySourceKey(
    profile.bombsquad_runs,
    run,
    MAX_LOCAL_RUNS,
    (entry) => entry.finished_at
  )
  profile.updated_at = timestamp
  profile.last_seen_at = timestamp
  saveProfile(profile, storage)
  return { kind: 'bombsquad_run', profile_id: profile.profile_id, run }
}

export interface RecordOracleLocalSignInput {
  sessionId: string
  signDate: string
  ben: string
  bian: string
  yaoValues: [number, number, number, number, number, number]
  createdAt?: string
}

export function recordOracleLocalSign(
  input: RecordOracleLocalSignInput,
  storage = browserStorage()
): ArcadeProfileEvent | null {
  if (input.sessionId.length === 0 || input.signDate.length === 0) return null
  const profile = ensureArcadeLocalProfile(storage)
  const timestamp = nowIso()
  const sign: OracleProfileSign = {
    source_key: oracleSignSourceKey(input.signDate, input.sessionId),
    session_id: input.sessionId,
    sign_date: input.signDate,
    ben: input.ben,
    bian: input.bian,
    yao_values: input.yaoValues,
    created_at: input.createdAt ?? timestamp,
  }
  profile.oracle_signs = upsertBySourceKey(
    profile.oracle_signs,
    sign,
    MAX_LOCAL_SIGNS,
    (entry) => entry.created_at
  )
  profile.updated_at = timestamp
  profile.last_seen_at = timestamp
  saveProfile(profile, storage)
  return { kind: 'oracle_sign', profile_id: profile.profile_id, sign }
}

export function summarizeArcadeLocalProfile(
  profile: ArcadeLocalProfile | null,
  today = getTodayString()
): ArcadeProfileSummary {
  return summarizeArcadeProfile({
    profileId: profile?.profile_id,
    bombsquadRuns: profile?.bombsquad_runs ?? [],
    oracleSigns: profile?.oracle_signs ?? [],
    today,
  })
}

export function getClaimableArcadeProfileEvents(
  profile: ArcadeLocalProfile | null
): ArcadeProfileEvent[] {
  if (!profile) return []
  const claimed = new Set(profile.claimed_source_keys)
  return [
    ...profile.bombsquad_runs
      .filter((run) => !claimed.has(run.source_key))
      .map(
        (run): ArcadeProfileEvent => ({
          kind: 'bombsquad_run',
          profile_id: profile.profile_id,
          run,
        })
      ),
    ...profile.oracle_signs
      .filter((sign) => !claimed.has(sign.source_key))
      .map(
        (sign): ArcadeProfileEvent => ({
          kind: 'oracle_sign',
          profile_id: profile.profile_id,
          sign,
        })
      ),
  ]
}

export function markArcadeProfileEventsClaimed(
  sourceKeys: string[],
  storage = browserStorage()
): ArcadeLocalProfile | null {
  const profile = readArcadeLocalProfile(storage)
  if (!profile) return null
  const claimed = new Set(profile.claimed_source_keys)
  for (const key of sourceKeys) claimed.add(key)
  profile.claimed_source_keys = [...claimed].sort()
  profile.updated_at = nowIso()
  saveProfile(profile, storage)
  return profile
}
