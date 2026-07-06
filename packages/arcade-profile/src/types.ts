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

export type ArcadeDailyLoopActivityId = 'bombsquad_daily' | 'oracle_sign'

export interface ArcadeDailyLoopActivityStatus {
  completed: boolean
  completed_at: string | null
}

export interface ArcadeDailyLoopChecklist {
  bombsquad_daily: ArcadeDailyLoopActivityStatus
  oracle_sign: ArcadeDailyLoopActivityStatus
}

export interface ArcadeStreakSummary {
  today_completed: boolean
  current_days: number
  longest_days: number
  last_active_date: string | null
}

export interface ArcadeDailyLoopSummary {
  date: string
  checklist: ArcadeDailyLoopChecklist
  streak: ArcadeStreakSummary
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
  daily_loop: ArcadeDailyLoopSummary
}

export interface ArcadePublicProfileStatus {
  claimed: boolean
  public_label: string | null
}

export interface ArcadeProfileResponse {
  profile: ArcadeProfileSummary
  public_profile: ArcadePublicProfileStatus
}

export interface ArcadeProfileClaimBody {
  profile_id: string
  events: ArcadeProfileEvent[]
  public_label?: string
}

export interface ArcadeProfileClaimResponse {
  profile: ArcadeProfileSummary
  source_keys: string[]
  inserted: number
  public_profile: {
    claimed: true
    public_label: string
  }
}

export interface ArcadeStreakLeaderboardEntry {
  rank: number
  public_label: string
  current_streak_days: number
  longest_streak_days: number
  last_active_date: string
  today: {
    bombsquad_defused: boolean
    oracle_signed: boolean
  }
}

export interface ArcadeStreakLeaderboardResponse {
  date: string
  entries: ArcadeStreakLeaderboardEntry[]
}
