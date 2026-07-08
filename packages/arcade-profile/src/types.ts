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

/* One product day in the recent-history window. Checklist booleans use the
   same qualification rules as the streak (daily defused / same-day sign);
   `best_daily` and `sign` carry that day's showable records for the /me view. */
export interface ArcadeProfileHistoryDay {
  date: string
  bombsquad_daily_completed: boolean
  oracle_signed: boolean
  /** BombSquad runs (any mode / outcome) finished on this product day. */
  runs: number
  /** Fastest defused daily run of the day, or null. */
  best_daily: BombSquadProfileRun | null
  /** The day's Oracle sign (latest by created_at when re-cast), or null. */
  sign: OracleProfileSign | null
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
  /** The last 7 product days (today first) — the /me recent-record view. */
  history: ArcadeProfileHistoryDay[]
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

/* The community feed is a REAL event stream — every item is synthesized from a
   durable play event of a player who has claimed a public profile. There are
   exactly three honest, timestamped templates:
     - daily_clear      通关         a daily-challenge defusal
     - leaderboard_entry 上榜        the day a player (re)entered the streak board
     - streak_milestone 连续打卡里程碑 a streak reaching 7 / 14 / 30 / 60 days
   No synthetic / demo events are ever produced. An empty window renders the
   honest quiet state, never padded fakes. */
export type ArcadeCommunityFeedTemplate = 'daily_clear' | 'leaderboard_entry' | 'streak_milestone'

export interface ArcadeCommunityFeedItem {
  /** Opaque, deterministic per underlying event (stable across template
      reclassification); the like key. Never a raw run_id / source_key. */
  id: string
  template: ArcadeCommunityFeedTemplate
  /** The privacy-vetted public label — the only identity the feed ever exposes. */
  public_label: string
  /** ISO timestamp of the real event (finished_at / created_at). Relative time
      is rendered live from this on the client — never a frozen string. */
  at: string
  /** Defusal time in ms — present on daily_clear only. */
  duration_ms?: number
  /** Streak length in days — present on streak_milestone only. */
  streak_days?: number
  like_count: number
  /** Whether the requesting viewer has liked this item (always false for anon). */
  liked: boolean
}

export interface ArcadeCommunityFeedResponse {
  items: ArcadeCommunityFeedItem[]
  /** Cursor for the next page: the ISO `at` of the last item, or null when the
      window is exhausted. A follow-up read passes it as `?before=`. */
  next_before: string | null
}

export interface ArcadeCommunityLikeResponse {
  event_id: string
  like_count: number
  liked: boolean
}
