export interface ScoreSubmission {
  date: string // YYYY-MM-DD
  nickname: string // max 20 chars, sanitized server-side
  time_ms: number // total game time in milliseconds
  attempt_number: number // which attempt this was today
  module_times: number[] // time per module in ms (length 4)
  operations_hash: string // SHA-256 of operation log for post-hoc verification
  ai_tool: string // required: 'claude' | 'chatgpt' | 'gemini' | string
  ai_model?: string // optional concrete model/version, omitted when blank
  device_id: string // UUID from localStorage
  run_id?: string // client-generated UUID stable per run; used for backend dedup
}

export interface ScoreSubmissionResponse {
  rank: number
  total_players: number
  /** Player's best time today (ms) — typically the lower of currentBest and the just-submitted time. */
  personal_best_ms?: number
  /** Attempt number on which the personal_best was set today.
   *  Optional because legacy KV records pre-dating this field have no attempt_number. */
  personal_best_attempt?: number
}

export interface LeaderboardEntry {
  rank: number
  nickname: string
  time_ms: number
  attempt_number: number
  ai_tool?: string
  ai_model?: string
}

export interface LeaderboardResponse {
  date: string
  entries: LeaderboardEntry[]
}
