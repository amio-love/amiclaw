import type { ScoreSubmission } from '../../../shared/leaderboard-types'
import type { EventName, EventPayload } from '../../../shared/event-types'
import { MODULE_ADVANCE_DELAY_MS } from '../../../shared/game-timing'

// --- Plausibility floor (the daily time board's anti-cheat, F1) --------------
// The daily leaderboard ranks by ascending wall-clock time, and the homepage
// 「最快拆弹」 marketing stat reads the fastest board row — so an implausibly
// fast entry both tops the board over real humans and poisons the homepage.
//
// These are PLAUSIBILITY floors, NOT tamper-proof anti-cheat. `time_ms` and
// `module_times` are both client-reported (the run has no server-authoritative
// timer, and `operations_hash` is still an 'mvp-placeholder'), so a determined
// forger who submits a self-consistent but fabricated payload still passes.
// True anti-cheat needs a server-timed session — an out-of-scope followup. What
// these floors DO buy: they reject the fast automated / scripted runs that
// actually reached the board (a ~36s full clear topped real 3:02 / 4:39 human
// runs), and they heal the homepage stat that reads the same board.
//
// The floor is set toward the human+AI band, not at the slowest observed human:
// a full clear requires a human to read all four modules aloud to an EXTERNAL
// voice AI, hear each computed answer back, and physically execute it —
// including the button module's hold-until-target-color wait, which has an
// irreducible real-time cost. 60s sits ~1.7x above the automated 36s that
// reached the board and ~3x below the fastest genuine human run observed
// (3:02), leaving ample headroom for a skilled human+AI pair while rejecting
// automation. Raise it as real human-run data accumulates.
// Exported so the leaderboard READ path (get-leaderboard.ts) can apply the same
// floor as this WRITE-time validation: an integrity sweep that hides any row
// below the floor at display time (legacy sub-floor junk written before the
// floor shipped, still inside the 48h KV TTL), without hard-deleting data. One
// SSOT for the number so the write gate and the read filter can never drift.
export const MIN_GAME_TIME_MS = 60_000 // 60 seconds minimum — the collaborative-loop plausibility floor
const MAX_GAME_TIME_MS = 3_600_000 // 1 hour max
// Structural per-module floor: no single module can be honestly solved faster
// than one read→relay-to-AI→execute round-trip. A sub-floor module time means a
// scripted/replayed solve even when the reported total clears MIN_GAME_TIME_MS,
// so it is rejected on top of the total floor and the module-sum consistency
// check below. Kept conservative (well under the ~15s/module the 60s total
// implies) so a genuinely fast module never false-positives.
const MIN_MODULE_TIME_MS = 3_000 // 3 seconds minimum per module
const MAX_NICKNAME_LEN = 20
export const MAX_AI_TOOL_LEN = 40
export const MAX_AI_MODEL_LEN = 80

// Module-sum tolerance. The wall-clock `time_ms` is always ≥ the sum of the
// per-module times because each MODULE_COMPLETE → NEXT_MODULE transition adds a
// wall-clock gap (MODULE_ADVANCE_DELAY_MS) that is not attributed to any module.
// A run with N modules has (N − 1) such gaps, so the legitimate overshoot scales
// with the module count rather than being a fixed budget. BASE_MARGIN absorbs
// timing jitter (clock resolution, the brief render/dispatch latency around each
// stamp). PER_TRANSITION_SLACK_MS is the per-gap allowance — pinned to the real
// frontend auto-advance delay via the shared constant so the two never drift.
const MODULE_SUM_BASE_MARGIN_MS = 2_000
const PER_TRANSITION_SLACK_MS = MODULE_ADVANCE_DELAY_MS

const VALID_EVENT_NAMES: ReadonlySet<EventName> = new Set<EventName>([
  'game_start',
  'module_solve',
  'game_complete',
  'game_abandon',
  'manual_load_failed',
  'replay_intent',
  'game_failed_strikeout',
  'game_ended_timeout',
  'survey_submit',
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
  if (typeof submission.ai_tool !== 'string') return fail('Invalid ai_tool')
  if (sanitizeLeaderboardText(submission.ai_tool, MAX_AI_TOOL_LEN).length === 0) {
    return fail('Invalid ai_tool')
  }
  if (submission.ai_model !== undefined && typeof submission.ai_model !== 'string') {
    return fail('Invalid ai_model')
  }
  if (submission.run_id !== undefined && typeof submission.run_id !== 'string') {
    return fail('Invalid run_id')
  }

  if (submission.time_ms < MIN_GAME_TIME_MS) return fail('Time too short — minimum 60 seconds')
  if (submission.time_ms > MAX_GAME_TIME_MS) return fail('Time exceeds maximum')

  // Date must be today or yesterday (allow timezone skew)
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (submission.date !== today && submission.date !== yesterday) {
    return fail('Invalid date — must be today or yesterday')
  }

  // Module times must sum to ≈ total time, but the allowed window is ASYMMETRIC.
  // Honest play always has wall-clock `time_ms` ≥ sum(module_times): the only
  // wall-clock not attributed to a module is the inter-module transition gap,
  // and that is strictly positive. So `diff = time_ms − moduleSum` is normally
  // ≥ 0, growing by PER_TRANSITION_SLACK_MS per transition.
  //
  //   - High side (positive diff): the legitimate overshoot. Allow up to
  //     BASE_MARGIN jitter + PER_TRANSITION_SLACK_MS × (n − 1) transitions.
  //   - Low side (negative diff): a player UNDER-reporting time_ms relative to
  //     their module sum has no legitimate cause — and since the leaderboard
  //     ranks by ascending time_ms, under-reporting is exactly how one would
  //     cheat for a better rank. Keep this side tight at BASE_MARGIN (the same
  //     2000ms the original symmetric check enforced), so widening the high
  //     side to cover transitions does not open a low-side cheat window.
  //
  // Boundaries stay strict (`diff` exactly at either bound still passes) and the
  // check still only runs for a length-4 module_times array.
  if (Array.isArray(submission.module_times) && submission.module_times.length === 4) {
    // Per-module plausibility floor (F1): a single module solved faster than one
    // read→relay→execute round-trip is not human play. Applied here, alongside
    // the sum-consistency check, so a padded total cannot hide an instant module.
    if (submission.module_times.some((t) => t < MIN_MODULE_TIME_MS)) {
      return fail('Module solved implausibly fast')
    }
    const moduleSum = submission.module_times.reduce((a, b) => a + b, 0)
    const diff = submission.time_ms - moduleSum
    const upperBound =
      MODULE_SUM_BASE_MARGIN_MS + PER_TRANSITION_SLACK_MS * (submission.module_times.length - 1)
    if (diff < -MODULE_SUM_BASE_MARGIN_MS || diff > upperBound) {
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

  return sanitizeLeaderboardText(stripped, MAX_NICKNAME_LEN) || 'Anonymous'
}

export function sanitizeLeaderboardText(raw: string, maxLength: number): string {
  // Strip HTML tags iteratively. Keep Unicode letters/numbers (including CJK)
  // plus a small punctuation set that is safe in plain text leaderboard rows.
  let stripped = raw
  let prev: string
  do {
    prev = stripped
    stripped = stripped.replace(/<[^>]*>/g, '')
  } while (stripped !== prev)

  return stripped
    .replace(/[^\p{L}\p{N}\s\-_.!?]/gu, '')
    .trim()
    .slice(0, maxLength)
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

  // A `survey_submit` event with no answers is malformed. Other events may
  // legitimately omit `data`, so this gate is specific to `survey_submit`.
  // A present `data` has already passed the object / non-null / non-array
  // checks above, so an empty-object test is sufficient here.
  if (p.event === 'survey_submit') {
    if (p.data === undefined || Object.keys(p.data as Record<string, unknown>).length === 0) {
      return fail('survey_submit requires answer data')
    }
  }

  return { ok: true }
}

export type { EventPayload }
