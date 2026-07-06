import { getTodayString } from '../../../shared/date'
import type { ArcadeProfileDb } from './db'
import { summarizeArcadeProfile } from './summary'
import type {
  ArcadeProfileEvent,
  ArcadeProfileSummary,
  BombSquadProfileRun,
  OracleProfileSign,
} from './types'

export type { ArcadeProfileDb } from './db'

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
    bombsquadRuns,
    oracleSigns,
    today: deps.today?.() ?? getTodayString(),
  })
}
