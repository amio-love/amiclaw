import type { ScoreSubmission } from '../../../shared/leaderboard-types'
import type { EventName, EventPayload } from '../../../shared/event-types'

const MIN_GAME_TIME_MS = 15_000 // 15 seconds minimum — reject obvious cheats
const MAX_GAME_TIME_MS = 3_600_000 // 1 hour max
const MAX_NICKNAME_LEN = 20

const VALID_EVENT_NAMES: ReadonlySet<EventName> = new Set<EventName>([
  'game_start',
  'module_solve',
  'game_complete',
  'game_abandon',
  'manual_load_failed',
  'replay_intent',
])

// UUID v4 shape — any 36-char canonical UUID matches; we deliberately do not
// enforce the version nibble here because `crypto.randomUUID()` already
// emits v4, and a future swap to v7 should not require a validator change.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_EVENT_DATA_BYTES = 1024 // 1KB cap on the optional `data` payload

export interface ValidationResult {
  ok: boolean
  error?: string
}

export function validateSubmission(submission: ScoreSubmission): ValidationResult {
  if (typeof submission.time_ms !== 'number') return fail('Invalid time_ms')
  if (typeof submission.date !== 'string') return fail('Invalid date')
  if (typeof submission.device_id !== 'string') return fail('Invalid device_id')
  if (typeof submission.nickname !== 'string') return fail('Invalid nickname')

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
  // Strip HTML tags iteratively. CodeQL flags single-pass `/<[^>]*>/g` as
  // js/incomplete-multi-character-sanitization because input like
  // `<sc<script>ript>` could in principle reintroduce `<script` after one
  // pass; iterating until the regex stops matching closes that gap. The
  // whitelist on the next line is a defence-in-depth backstop (only
  // alphanumerics and a small punctuation set survive), so even pathological
  // input cannot smuggle markup through.
  let stripped = raw
  let prev: string
  do {
    prev = stripped
    stripped = stripped.replace(/<[^>]*>/g, '')
  } while (stripped !== prev)

  return (
    stripped
      .replace(/[^\w\s\-_.!?]/g, '') // allow alphanumeric + safe punctuation
      .trim()
      .slice(0, MAX_NICKNAME_LEN) || 'Anonymous'
  )
}

function fail(error: string): ValidationResult {
  return { ok: false, error }
}

/**
 * Validate an event payload posted to `/api/events`.
 *
 * Mirrors `validateSubmission`'s posture: structural type checks first, then
 * domain rules. The `date` window matches the leaderboard rule (today or
 * yesterday UTC) so a client whose clock is skewed by < 24h still ingests.
 */
export function validateEvent(payload: unknown): ValidationResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return fail('Invalid payload')
  }
  const p = payload as Record<string, unknown>

  if (typeof p.event !== 'string') return fail('Invalid event')
  if (!VALID_EVENT_NAMES.has(p.event as EventName)) return fail('Unknown event name')

  if (typeof p.timestamp !== 'string') return fail('Invalid timestamp')
  const parsedTs = Date.parse(p.timestamp)
  if (Number.isNaN(parsedTs)) return fail('Invalid timestamp')
  const tsDate = p.timestamp.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (tsDate !== today && tsDate !== yesterday) {
    return fail('Invalid timestamp — must be today or yesterday')
  }

  if (typeof p.device_id !== 'string') return fail('Invalid device_id')
  if (!UUID_REGEX.test(p.device_id)) return fail('Invalid device_id')

  if (p.data !== undefined) {
    if (typeof p.data !== 'object' || p.data === null || Array.isArray(p.data)) {
      return fail('Invalid data')
    }
    try {
      const serialized = JSON.stringify(p.data)
      // TextEncoder gives byte-accurate length for the UTF-8 wire form,
      // which is what KV-write size and POST body limits actually count.
      if (new TextEncoder().encode(serialized).byteLength > MAX_EVENT_DATA_BYTES) {
        return fail('data payload too large')
      }
    } catch {
      return fail('data not serializable')
    }
  }

  return { ok: true }
}

export type { EventPayload }
