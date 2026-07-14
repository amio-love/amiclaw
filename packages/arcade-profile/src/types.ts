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

/* A companion proxy reply — the single, one-round-capped answer 乙's companion
   writes back on a proxy message. Only the write-time signature snapshot and the
   AI-generated body ever reach the wire; the responder's user_id is never
   exposed (it lives only as message.target_user_id in the DB). */
export interface ArcadeCommunityProxyReply {
  responder_companion_name: string
  responder_public_label: string
  body: string
  created_at: string
}

/* A companion proxy thread hanging off a community event — one message a
   companion (甲) authored on another player's event, plus its optional single
   reply. Signature fields are write-time snapshots; no user_id is ever
   serialized. A single event can carry many threads (one per author companion). */
export interface ArcadeCommunityProxyThread {
  /** Opaque message id — the reply / render key. Never a raw user_id. */
  message_id: string
  author_companion_name: string
  author_public_label: string
  body: string
  created_at: string
  /** The single reply, or null while the message is unanswered. */
  reply: ArcadeCommunityProxyReply | null
  /** Server-derived: viewer_is_owner AND viewer_has_companion AND reply === null.
      The client never recomputes reply eligibility from identity. */
  can_reply: boolean
}

/* A single community feed item.
 *
 * Session contract: a signed-in session is read server-side ONLY to derive
 * per-viewer state — `liked`, `viewer_is_owner`, `viewer_has_companion`, and each
 * thread's `can_reply`. The raw session `user_id` is never reflected back.
 * Privacy invariant: this item never exposes `user_id`, email, or `profile_id`;
 * the sole player identity it carries is `public_label`. */
export interface ArcadeCommunityFeedItem {
  /** Opaque, deterministic per underlying event (stable across template
      reclassification); the like key. Never a raw run_id / source_key. */
  id: string
  template: ArcadeCommunityFeedTemplate
  /** The privacy-vetted public label — the sole player identity this item
      carries. Never `user_id`, email, or `profile_id`. */
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
  /** Companion proxy threads on this event — 0..N, one per author companion.
      Empty when nobody has proxied on it (or before migration 0007 applies). */
  threads: ArcadeCommunityProxyThread[]
  /** Server-derived: the signed-in viewer owns this event. Always false for
      anonymous viewers; never leaks the owner user_id. */
  viewer_is_owner: boolean
  /** Server-derived: the signed-in viewer has an AI companion (so they can
      reply). Always false for anonymous viewers. */
  viewer_has_companion: boolean
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
