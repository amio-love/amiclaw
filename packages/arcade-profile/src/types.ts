export type ArcadeProfileEventKind = 'bombsquad_run' | 'oracle_sign'

export type BombSquadProfileMode = 'daily' | 'practice'

export type BombSquadProfileOutcome =
  | 'defused'
  | 'exploded'
  | 'practice-cleared'
  | 'practice-timeout'
  | 'daily-timeout'

export interface BombSquadProfileRun {
  source_key: string
  run_id: string
  mode: BombSquadProfileMode
  outcome: BombSquadProfileOutcome
  duration_ms: number
  attempt_number: number
  module_count: number
  completed_modules: number
  strike_count: number
  finished_at: string
}

export interface OracleProfileSign {
  source_key: string
  session_id: string
  sign_date: string
  ben: string
  bian: string
  yao_values: [number, number, number, number, number, number]
  created_at: string
}

export type ArcadeProfileEvent =
  | { kind: 'bombsquad_run'; profile_id?: string; run: BombSquadProfileRun }
  | { kind: 'oracle_sign'; profile_id?: string; sign: OracleProfileSign }

export interface ArcadeLocalProfile {
  version: 1
  profile_id: string
  created_at: string
  updated_at: string
  last_seen_at: string
  bombsquad_runs: BombSquadProfileRun[]
  oracle_signs: OracleProfileSign[]
  claimed_source_keys: string[]
}

export interface BombSquadProfileSummary {
  recent: BombSquadProfileRun | null
  best_daily: BombSquadProfileRun | null
  best_practice: BombSquadProfileRun | null
}

export interface OracleProfileSummary {
  recent: OracleProfileSign | null
}

export interface ArcadeProfileSummary {
  profile_id?: string
  last_activity_at: string | null
  today_played: boolean
  counts: {
    bombsquad_runs: number
    oracle_signs: number
  }
  bombsquad: BombSquadProfileSummary
  oracle: OracleProfileSummary
}

export interface ArcadeProfileResponse {
  profile: ArcadeProfileSummary
}

export interface ArcadeProfileClaimBody {
  profile_id: string
  events: ArcadeProfileEvent[]
}

export interface ArcadeProfileClaimResponse {
  profile: ArcadeProfileSummary
  source_keys: string[]
  inserted: number
}
