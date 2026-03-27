import type { ScoreSubmission } from '../../../shared/leaderboard-types'

const MIN_GAME_TIME_MS = 15_000    // 15 seconds minimum — reject obvious cheats
const MAX_GAME_TIME_MS = 3_600_000 // 1 hour max
const MAX_NICKNAME_LEN = 20

export interface ValidationResult {
  ok: boolean
  error?: string
}

export function validateSubmission(submission: ScoreSubmission): ValidationResult {
  if (typeof submission.time_ms !== 'number')    return fail('Invalid time_ms')
  if (typeof submission.date !== 'string')       return fail('Invalid date')
  if (typeof submission.device_id !== 'string')  return fail('Invalid device_id')
  if (typeof submission.nickname !== 'string')   return fail('Invalid nickname')

  if (submission.time_ms < MIN_GAME_TIME_MS) return fail('Time too short — minimum 15 seconds')
  if (submission.time_ms > MAX_GAME_TIME_MS) return fail('Time exceeds maximum')

  // Date must be today or yesterday (allow timezone skew)
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (submission.date !== today && submission.date !== yesterday) {
    return fail('Invalid date — must be today or yesterday')
  }

  // Module times must sum to ≈ total time (within 2 seconds)
  if (Array.isArray(submission.module_times) && submission.module_times.length === 4) {
    const moduleSum = submission.module_times.reduce((a, b) => a + b, 0)
    if (Math.abs(moduleSum - submission.time_ms) > 2_000) {
      return fail('Module times do not match total time')
    }
  }

  return { ok: true }
}

export function sanitizeNickname(raw: string): string {
  return (
    raw
      .replace(/<[^>]*>/g, '')              // strip HTML tags
      .replace(/[^\w\s\-_.!?]/g, '')        // allow alphanumeric + safe punctuation
      .trim()
      .slice(0, MAX_NICKNAME_LEN) || 'Anonymous'
  )
}

function fail(error: string): ValidationResult {
  return { ok: false, error }
}
